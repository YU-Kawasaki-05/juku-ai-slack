#!/usr/bin/env bash
# =============================================================================
#  juku-ai-slack — Supabase DB バックアップスクリプト
# =============================================================================
#  ⚠️⚠️  このファイルは PUBLIC な GitHub リポジトリに置かれている  ⚠️⚠️
#
#  - DB の接続文字列・パスワード・プロジェクト ref を **絶対にこのファイルに
#    書き込まないこと**。すべて環境変数から読む。
#  - 出力される .sql には生徒の氏名・会話ログ・レポート（個人情報）が
#    そのまま入る。**出力先をこのリポジトリに置かない**
#    （`BACKUP_DIR` の既定値はリポジトリ外の `../juku-ai-backups`）。
#  - このスクリプトを CI で回すなら、DB 認証情報を Secrets に持つのは
#    **private リポジトリ側**にすること。public リポジトリの Actions artifact は
#    認証なしで誰でもダウンロードできる。
#    → 手順書: docs/03_技術設計/09_バックアップとリストア.md
# =============================================================================
#
#  使い方:
#    SUPABASE_DB_URL='postgresql://postgres:PW@db.xxxx.supabase.co:5432/postgres' \
#      ./scripts/backup-db.sh
#
#    # または（パスワードは自動で percent-encode される）
#    SUPABASE_PROJECT_REF=xxxx SUPABASE_DB_PASSWORD='...' ./scripts/backup-db.sh
#
#  環境変数:
#    SUPABASE_DB_URL        接続文字列（これがあれば他は不要）
#    SUPABASE_PROJECT_REF   プロジェクト ref（URL 未指定時に必須）
#    SUPABASE_DB_PASSWORD   DB パスワード（URL 未指定時に必須）
#    SUPABASE_DB_HOST       既定 db.<ref>.supabase.co（pooler を使うなら上書き）
#                           ⚠ Direct connection は IPv6 専用。CI（GitHub Actions）は
#                             IPv4 なので Session pooler の文字列を使うこと
#    SUPABASE_DB_PORT       既定 5432
#    SUPABASE_DB_USER       既定 postgres（pooler は postgres.<ref>）
#    SUPABASE_DB_NAME       既定 postgres
#    BACKUP_DIR             出力先（既定 ../juku-ai-backups。リポジトリ外）
#    SUPABASE_CLI           supabase CLI のパス（既定は自動検出）
#    BACKUP_MIN_PERSONS     persons の最小行数（既定 1。0 で無効化）
#    BACKUP_EXCLUDE_TABLES  データダンプから除くテーブル（既定は下記の Storage 内部）
#    BACKUP_LOCAL=1         ローカル Supabase を対象にする（リストア検証用）
#
#  終了コード: 0 = 全チェック合格 / それ以外 = 失敗（部分出力は破棄される）
# =============================================================================
set -euo pipefail

readonly SCRIPT_NAME="backup-db.sh"

# --- 出力（認証情報は絶対に流さない） -----------------------------------------
log()  { printf '[%s] %s\n'        "$SCRIPT_NAME" "$*" >&2; }
fail() { printf '[%s] FATAL: %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

# 接続文字列がログや CLI のエラー出力に混ざったときにパスワードを潰す
scrub() { sed -E 's#(postgres(ql)?://[^:/@]+):[^@]*@#\1:***@#g'; }

# --- 引数 ---------------------------------------------------------------------
case "${1:-}" in
  # 先頭のコメントブロック（2行目から最初の非コメント行まで）をそのまま usage として出す
  -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
  '') ;;
  *) fail "不明な引数: $1（--help を参照）" ;;
esac

# --- supabase CLI の解決 ------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${SUPABASE_CLI:-}" ]]; then
  CLI=("$SUPABASE_CLI")
elif [[ -x "$REPO_ROOT/node_modules/.bin/supabase" ]]; then
  CLI=("$REPO_ROOT/node_modules/.bin/supabase")
elif command -v supabase >/dev/null 2>&1; then
  CLI=(supabase)
elif command -v pnpm >/dev/null 2>&1; then
  CLI=(pnpm exec supabase)
else
  fail "supabase CLI が見つからない。pnpm install か SUPABASE_CLI= で指定する"
fi

CLI_VERSION="$("${CLI[@]}" --version 2>/dev/null | head -1 || echo unknown)"
log "supabase CLI: ${CLI[*]} (${CLI_VERSION})"

if ! docker info >/dev/null 2>&1; then
  log "WARN: docker が使えない。supabase db dump は pg_dump を Docker で動かすので失敗する可能性が高い"
  log "WARN: 代替手段は docs/03_技術設計/09_バックアップとリストア.md の「pg_dump を直接使う」参照"
fi

# --- 接続先の決定 -------------------------------------------------------------
# percent-encode（ASCII パスワード前提。非 ASCII を使うなら SUPABASE_DB_URL 側で
# 自分でエンコードして渡す）
urlencode() {
  local s="$1" out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

DUMP_TARGET=()   # supabase db dump に渡す接続系フラグ
SOURCE_LABEL=''  # MANIFEST に書く接続先（認証情報なし）

if [[ "${BACKUP_LOCAL:-}" == "1" ]]; then
  DUMP_TARGET=(--local --workdir "$REPO_ROOT")
  SOURCE_LABEL='local supabase (BACKUP_LOCAL=1)'
elif [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  DUMP_TARGET=(--db-url "$SUPABASE_DB_URL")
  SOURCE_LABEL="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#//[^@]*@#//#')"
elif [[ -n "${SUPABASE_PROJECT_REF:-}" && -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  db_host="${SUPABASE_DB_HOST:-db.${SUPABASE_PROJECT_REF}.supabase.co}"
  db_port="${SUPABASE_DB_PORT:-5432}"
  db_user="${SUPABASE_DB_USER:-postgres}"
  db_name="${SUPABASE_DB_NAME:-postgres}"
  DUMP_TARGET=(--db-url "postgresql://${db_user}:$(urlencode "$SUPABASE_DB_PASSWORD")@${db_host}:${db_port}/${db_name}")
  SOURCE_LABEL="postgresql://${db_host}:${db_port}/${db_name}"
else
  fail "接続先が未設定。SUPABASE_DB_URL か SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD を渡す"
fi
log "接続先: ${SOURCE_LABEL}"

# --- 出力先 -------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/../juku-ai-backups}"
# 存在しないパスでも判定できるよう、mkdir の前に「リポジトリ内か」を見る
case "${BACKUP_DIR}/" in
  "${REPO_ROOT}"/*)
    fail "BACKUP_DIR がリポジトリ内を指している（${BACKUP_DIR}）。個人情報を public リポジトリに置かないこと" ;;
esac
mkdir -p "${BACKUP_DIR}"
BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
# 相対パス経由でリポジトリ内に戻っていないか、正規化後にもう一度見る
case "${BACKUP_DIR}/" in
  "${REPO_ROOT}"/*)
    fail "BACKUP_DIR がリポジトリ内を指している（${BACKUP_DIR}）。個人情報を public リポジトリに置かないこと" ;;
esac

DATE="$(date -u +%Y-%m-%d)"
PREFIX="juku-ai-backup-${DATE}"

# 途中で落ちたものを「取れている」と誤認しないよう、全チェック通過後に本名へ移す
STAGE="$BACKUP_DIR/.staging-$$"
cleanup() {
  local rc=$?
  if (( rc != 0 )); then
    rm -rf "$STAGE"
    printf '[%s] ✗ バックアップ失敗（exit=%d）。部分出力は破棄した\n' "$SCRIPT_NAME" "$rc" >&2
  fi
}
trap cleanup EXIT
rm -rf "$STAGE"; mkdir -p "$STAGE"

F_ROLES="$STAGE/${PREFIX}-roles.sql"
F_SCHEMA="$STAGE/${PREFIX}-schema.sql"
F_DATA="$STAGE/${PREFIX}-data.sql"
F_MANIFEST="$STAGE/${PREFIX}-MANIFEST.txt"

# --- ダンプ -------------------------------------------------------------------
# supabase db dump は既定で「スキーマのみ」。データは --data-only が必須。
# 片方だけではリストアできないので 3 本すべて取る。
dump() {
  local label="$1" out="$2"; shift 2
  log "dump: ${label} ..."
  if ! "${CLI[@]}" db dump "${DUMP_TARGET[@]}" "$@" -f "$out" 2> >(scrub >&2); then
    fail "supabase db dump（${label}）が失敗した"
  fi
}

# postgres ロールに INSERT 権限が無い Storage 内部テーブル（実測 2026-08-27, storage-api v1.60）。
# 含めるとリストア時に "permission denied for table buckets_vectors" で
# --single-transaction のトランザクションが丸ごと巻き戻る。このアプリは使っていない。
# 将来 Storage / Auth が同種のテーブルを増やしたらここに足す（空文字で無効化できる）。
: "${BACKUP_EXCLUDE_TABLES=storage.buckets_vectors storage.vector_indexes}"
EXCLUDE_ARGS=()
for t in $(printf '%s' "$BACKUP_EXCLUDE_TABLES" | tr ',' ' '); do
  EXCLUDE_ARGS+=(-x "$t")
done

dump roles  "$F_ROLES"  --role-only
dump schema "$F_SCHEMA"
dump data   "$F_DATA"   --data-only --use-copy ${EXCLUDE_ARGS[@]+"${EXCLUDE_ARGS[@]}"}

# --- 健全性チェック（ここを通らないものはバックアップとして扱わない） ----------
: "${BACKUP_MIN_SCHEMA_BYTES:=10000}"
: "${BACKUP_MIN_DATA_BYTES:=1000}"
: "${BACKUP_MIN_TABLES:=16}"
: "${BACKUP_MIN_COPY:=20}"
: "${BACKUP_MIN_PERSONS:=1}"

# 1 本でも欠けていたら復元できないので、public スキーマの主要テーブルは名指しで確認する
REQUIRED_TABLES=(
  persons student_profiles reports report_chunks
  slack_channel_bindings slack_thread_sessions slack_messages attachments
  ai_usage_logs ai_error_logs slack_event_receipts jobs
  student_knowledge_states student_episodic_memories learning_concepts kill_switches
)
REQUIRED_COPY=(
  '"public"."persons"' '"public"."reports"' '"public"."slack_messages"'
  '"auth"."users"'     '"storage"."buckets"'
)

filesize() { wc -c < "$1" | tr -d ' '; }

check_size() {
  local f="$1" min="$2" label="$3" n
  [[ -s "$f" ]] || fail "${label} が空、または生成されていない: $(basename "$f")"
  n="$(filesize "$f")"
  (( n >= min )) || fail "${label} が小さすぎる（${n} bytes < ${min}）。ダンプが途中で切れた疑い: $(basename "$f")"
}

check_size "$F_SCHEMA" "$BACKUP_MIN_SCHEMA_BYTES" "スキーマダンプ"
check_size "$F_DATA"   "$BACKUP_MIN_DATA_BYTES"   "データダンプ"
[[ -f "$F_ROLES" ]] || fail "ロールダンプが生成されていない"

TABLE_COUNT="$(grep -c '^CREATE TABLE ' "$F_SCHEMA" || true)"
(( TABLE_COUNT >= BACKUP_MIN_TABLES )) || \
  fail "スキーマダンプの CREATE TABLE が ${TABLE_COUNT} 本しかない（期待 ${BACKUP_MIN_TABLES} 本以上）。空プロジェクトに繋いだ疑い"

for t in "${REQUIRED_TABLES[@]}"; do
  grep -q "^CREATE TABLE IF NOT EXISTS \"public\".\"${t}\"" "$F_SCHEMA" \
    || fail "スキーマダンプに public.${t} が無い。接続先プロジェクトが間違っている疑い"
done

COPY_COUNT="$(grep -c '^COPY ' "$F_DATA" || true)"
(( COPY_COUNT >= BACKUP_MIN_COPY )) || \
  fail "データダンプの COPY が ${COPY_COUNT} 本しかない（期待 ${BACKUP_MIN_COPY} 本以上）"

for c in "${REQUIRED_COPY[@]}"; do
  grep -qF "COPY ${c} " "$F_DATA" || fail "データダンプに ${c} の COPY が無い"
done

# COPY ブロックの行数 = そのテーブルの行数
rows_of() {
  awk -v want="COPY $1 " '
    index($0, want) == 1 { inblk = 1; next }
    inblk && $0 == "\\."  { inblk = 0 }
    inblk { n++ }
    END { print n + 0 }
  ' "$F_DATA"
}

ROWS_PERSONS="$(rows_of '"public"."persons"')"
if (( BACKUP_MIN_PERSONS > 0 )) && (( ROWS_PERSONS < BACKUP_MIN_PERSONS )); then
  fail "persons が ${ROWS_PERSONS} 行（期待 ${BACKUP_MIN_PERSONS} 行以上）。データが入っていないダンプを成功扱いしない"
fi

# --- MANIFEST（全チェック通過後にだけ書く） -----------------------------------
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  sha256() { echo 'n/a (no sha256 tool)'; }
fi

{
  echo "# juku-ai-slack DB backup manifest"
  echo "created_at_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source         : ${SOURCE_LABEL}"
  echo "supabase_cli   : ${CLI_VERSION}"
  echo "public_tables  : ${TABLE_COUNT}"
  echo "copy_blocks    : ${COPY_COUNT}"
  echo "excluded_data  : ${BACKUP_EXCLUDE_TABLES:-(none)}"
  echo
  echo "## files (リストアはこの順に psql で流す)"
  for f in "$F_ROLES" "$F_SCHEMA" "$F_DATA"; do
    printf '%-40s %12s bytes  sha256=%s\n' "$(basename "$f")" "$(filesize "$f")" "$(sha256 "$f")"
  done
  echo
  echo "## row counts"
  for t in "${REQUIRED_TABLES[@]}"; do
    printf '%-28s %s\n' "public.${t}" "$(rows_of "\"public\".\"${t}\"")"
  done
  printf '%-28s %s\n' "auth.users" "$(rows_of '"auth"."users"')"
  echo
  echo "## 含まれないもの"
  echo "- Storage の実ファイル（attachments バケットの画像本体）。DB にはメタデータ行だけ"
  echo "- Vercel / Slack / LLM の環境変数"
} > "$F_MANIFEST"

# --- 確定（本名へ移動） -------------------------------------------------------
for f in "$F_ROLES" "$F_SCHEMA" "$F_DATA" "$F_MANIFEST"; do
  mv -f "$f" "$BACKUP_DIR/$(basename "$f")"
done
# ここから先の些細な失敗で「失敗した」と報告しないよう trap を外す（成果物は確定済み）
trap - EXIT
rm -rf "$STAGE"

log "✓ バックアップ完了: ${BACKUP_DIR}/${PREFIX}-*.sql"
log "  public テーブル ${TABLE_COUNT} / COPY ${COPY_COUNT} / persons ${ROWS_PERSONS} 行"
log "  取れただけでは不十分。四半期に 1 回はリストア訓練を行う"
log "  → docs/03_技術設計/09_バックアップとリストア.md"
cat "$BACKUP_DIR/${PREFIX}-MANIFEST.txt" >&2
