# 受入テスト チェックリスト — Sprint 0（認証・管理画面の土台）

対象: ログイン認証・管理画面レイアウト・DB マイグレーション
実施方法: ローカルで `pnpm dev` 起動後、ブラウザで手動確認

---

## 事前準備

1. `.env.local` に Supabase の鍵が設定されていること（済）
2. Supabase にスタッフユーザーが1件登録されていること（要作成 → 下記コマンド参照）
3. `pnpm dev` でローカルサーバー起動（http://localhost:3000）

### スタッフユーザー作成コマンド（要 email/password 指定）

```bash
# .env.local を読み込んで admin API 経由で作成
set -a; source .env.local; set +a
curl -X POST "${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD","email_confirm":true}'
```

または Supabase ダッシュボード → Authentication → Users → Add user。

---

## テストケース

| # | シナリオ | 操作 | 期待結果 | 結果 |
|---|---------|------|---------|------|
| AT-0-01 | 未認証で管理画面アクセス | ブラウザで `/admin` を開く | `/login` にリダイレクトされる | ⬜ |
| AT-0-02 | ログイン画面表示 | `/login` を開く | メール・パスワード入力欄とログインボタンが表示される | ⬜ |
| AT-0-03 | 誤った認証情報 | 存在しないメール/パスワードでログイン | 「メールアドレスまたはパスワードが正しくありません。」と表示、遷移しない | ⬜ |
| AT-0-04 | 正しい認証情報 | 登録済みスタッフでログイン | `/admin` に遷移しダッシュボードが表示される | ⬜ |
| AT-0-05 | ダッシュボード表示 | ログイン後の `/admin` | 「生徒数 0」「レポート数 0」「ペンディングジョブ 0」が表示される | ⬜ |
| AT-0-06 | サイドバー | ダッシュボードのサイドバー | ダッシュボード/生徒管理/レポート/チャンネル設定/エラーログのリンクが表示される | ⬜ |
| AT-0-07 | ヘッダーにメール表示 | ログイン後のヘッダー右上 | ログイン中のメールアドレスが表示される | ⬜ |
| AT-0-08 | ログアウト | ヘッダーの「ログアウト」ボタン | `/login` に遷移し、再度 `/admin` を開くと `/login` に戻される | ⬜ |
| AT-0-09 | ログイン済みで /login | ログイン状態で `/login` を開く | `/admin` にリダイレクトされる | ⬜ |

---

## DB マイグレーション確認（Supabase ダッシュボード → Table Editor）

| # | 確認項目 | 期待結果 | 結果 |
|---|---------|---------|------|
| AT-0-10 | テーブル数 | 15の業務テーブル + BKT/エピソード記憶/FSRS の計18テーブルが存在 | ⬜ |
| AT-0-11 | RLS 有効化 | 全テーブルで Row Level Security が有効（盾アイコン） | ⬜ |
| AT-0-12 | pgvector | `report_chunks.embedding`, `student_episodic_memories.embedding` が vector 型 | ⬜ |

---

## 自動テスト（参考）

以下はコマンドで確認済み（CI でも実行）:

```bash
pnpm typecheck   # 型エラー 0
pnpm test        # ユニット 9 pass
pnpm lint        # warning/error 0
pnpm build       # ビルド成功
pnpm test:e2e    # Playwright（要ローカルサーバー）: AT-0-01, AT-0-02 相当
```
