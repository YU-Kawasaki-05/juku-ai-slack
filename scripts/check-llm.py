#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OpenAI 実キーでのモデル検証スクリプト（本番投入前の実測 / フェーズ 0）

このスクリプトは、本番投入の前に確定させたい事実を **1 回の実行でまとめて** 実測します。
最後の「まとめ」だけ読めば、次の 3 つがそのまま分かります。

  1. 本番の環境変数に設定すべき値（コピペできる形で出ます）
  2. コードを直す必要がある項目（reasoning・max_tokens の param 名・WebP 対応 など）
  3. コスト試算のどの数字を差し替えるか（画像 1 枚の実トークン数）

--------------------------------------------------------------------------------
 使い方（これだけ）
--------------------------------------------------------------------------------

    python3 scripts/check-llm.py

  実行すると API キーの入力を求められます。
  入力は画面に表示されず、シェルの履歴にも残りません（getpass）。

  結果を貼り付けたいとき（人が読む出力 + 機械可読な JSON の両方が出ます）:

    python3 scripts/check-llm.py --json | tee /tmp/check-llm.log

  短時間・低コストで最小限だけ見たいとき（⑥⑦⑧ を省略）:

    python3 scripts/check-llm.py --quick

--------------------------------------------------------------------------------
 実行するチェック
--------------------------------------------------------------------------------

  ① 認証             GET /models が通るか（401 ならここで中断）
  ② モデル実在確認   LLM_MODEL_DEFAULT / COMPLEX が実在する ID か
  ③ Chat             応答本文・usage・finish_reason・reasoning_tokens
                     （400 が出たら max_completion_tokens で自動再試行）
  ③-b reasoning OFF  reasoning が動いていた場合のみ、切る方法を実測で特定
  ④ Vision           64x64 の赤い PNG をその場で生成して送り「赤」と答えるか
  ⑤ Embedding        次元が 1536 か / 値がゼロ埋めでないか
  ⑥ detail           未指定 / auto / low / high / original でトークンがどう変わるか
  ⑦ 画像サイズ       64 / 512 / 1024 / 2048 px でトークンがどう変わるか
  ⑧ WebP             WebP 画像が受け付けられるか

  1 つ失敗しても残りは続行します（再実行の手間を減らすため）。

--------------------------------------------------------------------------------
 結果の読み方（重要）
--------------------------------------------------------------------------------

  各項目は **三値** で報告します。二値（OK / NG）にしないのは、
  「拒否された」と「そもそも試せていない」を混ぜると実害のある指示が出るからです。

    ✅ supported     200 が返り、使えることを確認できた
    ❌ rejected      パラメータ・形式そのものを理由に拒否された（400 系）
    —  undetermined  測定できなかった（429 / 401 / 403 / 5xx / 通信エラー / 前提の失敗）

  — は「使えない」ではなく「試せていない」です。
  — の項目を根拠にコードやドキュメントを変更しないでください。

  終了コード:
    0 すべて測定でき、問題もない
    1 実測で失敗した項目がある（直す必要がある）
    2 測定できなかった項目がある（クレジット追加などをして再実行が必要）

--------------------------------------------------------------------------------
 環境変数（すべて任意。未設定なら下の既定値を使う）
--------------------------------------------------------------------------------

    LLM_API_KEY          未設定なら実行時に対話入力（推奨）
    LLM_BASE_URL         既定 https://api.openai.com/v1
    LLM_MODEL_DEFAULT    既定 gpt-5.6-luna
    LLM_MODEL_COMPLEX    既定 gpt-5.6-terra
    EMBEDDING_BASE_URL   既定 LLM_BASE_URL と同じ
    EMBEDDING_MODEL      既定 text-embedding-3-small
    EMBEDDING_API_KEY    既定 LLM_API_KEY と同じ

  既定値の出典: docs/05_その他/2026-08-02_本番移行_決定事項と制約.md の §3 と §7

--------------------------------------------------------------------------------
 このファイルについての注意
--------------------------------------------------------------------------------

  * このリポジトリは PUBLIC です。**API キーをこのファイルに書かないこと。**
  * 外部ライブラリは使いません（標準ライブラリのみ）。pip install は不要です。
  * 送信する画像はハードコードした base64 ではなく、**実行時に生成** します
    （壊れた PNG による image_parse_error の偽陰性を一度踏んでいるため）。
  * 実行コストは概算 $0.05 未満です（最後に実測値を表示します）。

仕様の原典: docs/05_その他/2026-08-02_現状とロードマップ.md §7
追加項目の原典: docs/00_共通/確認事項.md §2-1 の 5〜7
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import re
import struct
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import zlib

# ------------------------------------------------------------------------------
# 既定値（決定事項と制約 §3 / §7）
# ------------------------------------------------------------------------------

DEF_BASE_URL = "https://api.openai.com/v1"
DEF_MODEL_DEFAULT = "gpt-5.6-luna"
DEF_MODEL_COMPLEX = "gpt-5.6-terra"
DEF_EMBEDDING_MODEL = "text-embedding-3-small"

EXPECTED_EMBEDDING_DIM = 1536      # RAG の前提。DB の vector(1536) と一致していないと保存できない
TUTOR_MAX_TOKENS = 1200            # 本番の回答上限（src/shared/lib/constants.ts）
MEASURE_MAX_TOKENS = 16            # トークン数だけ見る計測用（本文は要らないので最小にして節約する）
USD_JPY = 150                      # 決定事項 §4 の前提レート

# 検証にかかったコストを出すための単価（決定事項 §3-0）。$ / 1M tokens
PRICING = {
    "gpt-5.6-luna": (0.20, 1.20),
    "gpt-5.6-terra": (2.00, 12.00),
    "text-embedding-3-small": (0.02, 0.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
}

# ------------------------------------------------------------------------------
# 出力ヘルパー
# ------------------------------------------------------------------------------

# reasoning 関連のコード修正は 1 件にまとめる（モデルごとに増やさない）
REASONING_FIX = ("reasoning \u3092\u5207\u308b\uff08\u6c7a\u5b9a\u4e8b\u9805 \u00a73-3\uff09\u3002"
                 "openaiCompatibleClient.ts \u306f model / messages / max_tokens / temperature \u306e "
                 "4 \u3064\u3057\u304b\u9001\u3063\u3066\u3044\u306a\u3044")

TOKEN_PARAM_FIX = ("src/features/ai-answer/lib/llm/openaiCompatibleClient.ts \u306e "
                   "preferredTokenParam() \u306e\u63a8\u6e2c\u3092\u76f4\u3059"
                   "\uff08\u5916\u308c\u3066\u3044\u308b\u3068\u6bce\u56de 1 \u5f80\u5fa9\u7121\u99c4\u306b\u306a\u308b\uff09")

RESULT: dict = {"checks": {}, "summary": {}}
_CODE_CHANGES: list = []      # まとめ②に出す「コード修正が必要な項目」
_DOC_CHANGES: list = []       # まとめに出す「ドキュメント修正が必要な項目」
_UNDETERMINED: list = []      # まとめ②-b に出す「測定できなかったため保留」
USAGE_BY_MODEL: dict = {}     # 実行コスト集計用

# 「拒否された」と「測定できなかった」を混ぜないための三値。
# 二値（accepted True/False）にしていたせいで、クレジット切れ（429）の項目まで
# 「拒否されました / 修正が必要です」と断定してしまう事故を起こしたため分離した。
V_SUPPORTED = "supported"        # 200 が返り、機能が使えることを確認できた
V_REJECTED = "rejected"          # パラメータ・形式そのものを理由に拒否された（400 系）
V_UNDETERMINED = "undetermined"  # 測定できなかった（429 / 401 / 403 / 5xx / 通信エラー / 前提の失敗）

VERDICT_JA = {V_SUPPORTED: "受付", V_REJECTED: "拒否",
              V_UNDETERMINED: "判定不能"}


def hr(title: str) -> None:
    print("")
    print("=" * 70)
    print(" " + title)
    print("=" * 70)


def ok(msg: str) -> None:
    print("  \u2705 " + msg)


def warn(msg: str) -> None:
    print("  \u26a0\ufe0f  " + msg)


def ng(msg: str) -> None:
    print("  \u274c " + msg)


def unk(msg: str) -> None:
    """\u5224\u5b9a\u4e0d\u80fd\u3002\u274c\uff08\u5426\u5b9a\u7684\u306a\u6e2c\u5b9a\u7d50\u679c\uff09\u3068\u306f\u5225\u306e\u8a18\u53f7\u3092\u4f7f\u3046."""
    print("  \u2014 " + msg)


def info(msg: str) -> None:
    print("     " + msg)


def note(msg: str) -> None:
    """この数字が何を意味するかの 1 行解説."""
    print("  \u2192 " + msg)


def add_code_change(item: str, detail: str = None) -> None:
    """同じ対応内容は 1 件にまとめ、実測の内訳だけ足していく."""
    for row in _CODE_CHANGES:
        if row["item"] == item:
            if detail and detail not in row["details"]:
                row["details"].append(detail)
            return
    _CODE_CHANGES.append({"item": item, "details": [detail] if detail else []})


def display_pad(s: str, width: int) -> str:
    """全角を 2 桁として数え、表示幅を揃える."""
    w = sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)
    return s + " " * max(0, width - w)


def add_doc_change(item: str) -> None:
    if item not in _DOC_CHANGES:
        _DOC_CHANGES.append(item)


def add_undetermined(item: str, reason: str, howto: str = None) -> None:
    """測定できなかった項目。結論は書かず「なぜ測れなかったか」だけを持たせる."""
    for row in _UNDETERMINED:
        if row["item"] == item:
            return
    _UNDETERMINED.append({"item": item, "reason": reason, "howto": howto})


# ------------------------------------------------------------------------------
# 画像の実行時生成（外部依存なし）
# ------------------------------------------------------------------------------

def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_png(size: int, rgb=(255, 0, 0)) -> bytes:
    """size x size の単色 PNG を生成する（truecolor 8bit / filter 0）。

    ハードコードした base64 を使わないのは、壊れた画像だと API が image_parse_error を返し
    「Vision が使えない」という誤った結論になるため（過去に 1 度踏んでいる）。
    """
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    row = bytes([0]) + bytes(rgb) * size          # 各行の先頭 1 バイトはフィルタ種別
    idat = zlib.compress(row * size, 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


class _BitWriter:
    """VP8L 用の LSB ファーストのビット列ライター."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.acc = 0
        self.n = 0

    def put(self, value: int, nbits: int) -> None:
        self.acc |= (value & ((1 << nbits) - 1)) << self.n
        self.n += nbits
        while self.n >= 8:
            self.buf.append(self.acc & 0xFF)
            self.acc >>= 8
            self.n -= 8

    def done(self) -> bytes:
        if self.n:
            self.buf.append(self.acc & 0xFF)
        return bytes(self.buf)


def _vp8l_simple_code(bw: "_BitWriter", symbol: int) -> None:
    """シンボル 1 個だけのハフマン符号（= 復号時に 0 ビットしか消費しない）を書く."""
    bw.put(1, 1)          # simple code length code
    bw.put(0, 1)          # num_symbols - 1 = 0（1 シンボル）
    if symbol <= 1:
        bw.put(0, 1)      # 1 ビット表現
        bw.put(symbol, 1)
    else:
        bw.put(1, 1)      # 8 ビット表現
        bw.put(symbol, 8)


def make_webp(size: int, rgb=(255, 0, 0)) -> bytes:
    """size x size の単色 WebP（可逆 VP8L）を生成する。

    5 つのハフマン符号をすべて「1 シンボルのみ」にすると画素データが 0 ビットになるため、
    外部ライブラリなしでも単色画像だけは正しく組み立てられる（全サイズ 30 バイト）。
    ローカルで libwebp(dwebp) / ImageMagick / macOS ImageIO / Pillow の 4 つが
    「64x64 lossless・全画素 (255,0,0)」として復号できることを確認済み。
    """
    r, g, b = rgb
    bw = _BitWriter()
    bw.put(0x2F, 8)               # VP8L シグネチャ
    bw.put(size - 1, 14)          # width - 1
    bw.put(size - 1, 14)          # height - 1
    bw.put(0, 1)                  # alpha_is_used
    bw.put(0, 3)                  # version
    bw.put(0, 1)                  # 変換なし
    bw.put(0, 1)                  # カラーキャッシュなし
    bw.put(0, 1)                  # メタハフマンなし
    for sym in (g, r, b, 255, 0):  # green, red, blue, alpha, distance の順
        _vp8l_simple_code(bw, sym)
    payload = bw.done()
    chunk = b"VP8L" + struct.pack("<I", len(payload)) + payload
    if len(payload) % 2:
        chunk += b"\x00"          # RIFF のパディング（サイズ欄には含めない）
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def data_url(raw: bytes, mime: str) -> str:
    return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))


# ------------------------------------------------------------------------------
# HTTP（標準ライブラリのみ・例外を投げずに結果を返す）
# ------------------------------------------------------------------------------

def http_json(method: str, url: str, key: str, body=None, timeout: int = 180) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            status = res.getcode()
    except urllib.error.HTTPError as e:          # 4xx / 5xx は本文を読んで返す
        raw = e.read()
        status = e.code
    except urllib.error.URLError as e:
        return {"status": 0, "json": None, "text": "", "ms": int((time.time() - t0) * 1000),
                "error": "\u63a5\u7d9a\u5931\u6557: %s" % (e.reason,)}
    except Exception as e:                        # タイムアウトなど
        return {"status": 0, "json": None, "text": "", "ms": int((time.time() - t0) * 1000),
                "error": "%s: %s" % (type(e).__name__, e)}
    text = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    return {"status": status, "json": parsed, "text": text,
            "ms": int((time.time() - t0) * 1000), "error": None}


def api_error(res: dict) -> str:
    """API のエラー本文を 1 行に潰して返す."""
    if res.get("error"):
        return res["error"]
    err = (res.get("json") or {}).get("error")
    if isinstance(err, dict):
        parts = [str(err.get("message", ""))]
        for k in ("type", "code", "param"):
            if err.get(k):
                parts.append("%s=%s" % (k, err[k]))
        return " / ".join(p for p in parts if p)
    return (res.get("text") or "")[:300].replace("\n", " ")


# ------------------------------------------------------------------------------
# 三値判定（supported / rejected / undetermined）
#
#   「パラメータを理由に拒否された」と「リクエストが評価すらされなかった」は別物である。
#   後者を ❌ として報告すると、たとえばクレジット残高ゼロというだけで
#   「WebP は使えないので対応を外せ」という実害のある指示が出てしまう。
# ------------------------------------------------------------------------------

QUOTA_MARKERS = (
    "insufficient_quota",
    "credit_balance_exhausted",
    "exceeded your current quota",
    "billing_hard_limit_reached",
    "billing_not_active",
)

_QUOTA_STATE: dict = {"quota": False, "rate": False, "message": ""}


def quota_kind(res: dict):
    """429 系の種類を返す。'quota'（残高ゼロ）/ 'rate'（レート制限）/ None."""
    blob = ((res.get("text") or "") + " " + (api_error(res) or "")).lower()
    if any(m in blob for m in QUOTA_MARKERS):
        return "quota"
    if res.get("status") == 429:
        return "rate"
    return None


def note_quota_once(res: dict) -> None:
    """残高ゼロ / レート制限を最初に踏んだ時点で、以降が全滅することを明示する."""
    kind = quota_kind(res)
    if kind == "quota" and not _QUOTA_STATE["quota"]:
        _QUOTA_STATE["quota"] = True
        _QUOTA_STATE["message"] = (api_error(res) or "")[:200]
        print("")
        ng("【クレジット残高がゼロです】OpenAI が 429 / insufficient_quota を返しました。")
        info(_QUOTA_STATE["message"])
        note("これ以降、課金の発生する呼び出し（③ Chat 〜 ⑧ WebP）は **すべて測定できません**。")
        note("返ってくる 429 は「その機能が使えない」という意味ではなく「試せなかった」という意味です。"
             "以降に出る判定不能（—）を、否定的な結果として読まないでください。")
        note("対処: https://platform.openai.com/settings/organization/billing "
             "でクレジットを追加してから、このスクリプトを再実行してください。")
        print("")
    elif kind == "rate" and not _QUOTA_STATE["rate"]:
        _QUOTA_STATE["rate"] = True
        print("")
        warn("【レート制限（429）に当たりました】以降のチェックも同じ理由で測定できない可能性があります。")
        note("しばらく待ってから再実行してください。ここで出る判定不能（—）は否定的な結果ではありません。")
        print("")


def is_undetermined_status(res: dict) -> bool:
    """リクエストが評価すらされなかった失敗か（= 何も測れていないか）.

    True になるのは 429 / 401 / 403 / 408 / 5xx / ネットワークエラー。
    これらは「送った内容が悪い」ではなく「そもそも見てもらえなかった」なので、
    いかなる項目についても否定的な結論の根拠にできない。
    """
    status = res.get("status")
    if status == 0:
        return True
    if status in (401, 403, 408, 429):
        return True
    if isinstance(status, int) and status >= 500:
        return True
    return bool(quota_kind(res))


def classify_result(res: dict, keywords=()) -> str:
    """1 回の HTTP 結果を三値に分類する。

    keywords はそのチェックが検証している対象語（例: detail / webp）。
    400 が返っていても、エラー本文がその対象に言及していなければ
    「この項目については測れていない」= undetermined として扱う。
    """
    if res.get("status") == 200:
        return V_SUPPORTED
    note_quota_once(res)
    if is_undetermined_status(res):
        return V_UNDETERMINED
    if res.get("status") in (400, 422):
        blob = ((api_error(res) or "") + " " + (res.get("text") or "")).lower()
        if any(k.lower() in blob for k in keywords):
            return V_REJECTED
        return V_UNDETERMINED
    return V_UNDETERMINED      # 404 など、その項目の判定材料にならないもの


def undetermined_reason(res: dict) -> str:
    """なぜ測定できなかったのかを 1 行で返す."""
    status = res.get("status")
    if status == 0:
        return "サーバーに接続できませんでした（%s）。リクエストは送信されていません" % (
            res.get("error") or "接続失敗")
    kind = quota_kind(res)
    if kind == "quota":
        return "HTTP %s / クレジット残高がゼロ。リクエストは評価されていません" % status
    if kind == "rate":
        return "HTTP %s / レート制限。リクエストは評価されていません" % status
    if status in (401, 403):
        return "HTTP %s / 認証・権限で弾かれました。リクエストは評価されていません" % status
    if status == 404:
        return "HTTP 404 / モデルまたはエンドポイントが見つかりません。この項目の判定材料にはなりません"
    if isinstance(status, int) and status >= 500:
        return "HTTP %s / サーバー側のエラー。リクエストは評価されていません" % status
    if status in (400, 422):
        return ("HTTP %s で拒否されましたが、エラー本文がこの項目に言及していません"
                "（別の理由の 400 です）" % status)
    return "HTTP %s。この項目の判定材料にはなりません" % status


def undetermined_howto(res: dict) -> str:
    """どうすれば測定できるようになるかを 1 行で返す."""
    kind = quota_kind(res)
    if kind == "quota":
        return ("https://platform.openai.com/settings/organization/billing "
                "でクレジットを追加してから再実行すると測定できます。")
    if kind == "rate":
        return "しばらく待ってから再実行すると測定できます。"
    status = res.get("status")
    if status == 0:
        return "LLM_BASE_URL とネットワーク到達性を確認してから再実行してください。"
    if status in (401, 403):
        return "そのプロジェクトで有効な API キーを設定してから再実行してください。"
    if status == 404:
        return "② のモデル一覧から正しいモデル ID を選び直してから再実行してください。"
    if isinstance(status, int) and status >= 500:
        return "サーバー側の一時障害の可能性があります。時間をおいて再実行してください。"
    return "上のエラー本文の原因を解消してから再実行してください。"


def report_undetermined(item: str, res: dict) -> None:
    """判定不能をその場に表示し、まとめの保留リストにも積む（結論は書かない）."""
    reason = undetermined_reason(res)
    howto = undetermined_howto(res)
    unk("%s は **判定できませんでした**（測定できていないだけで、否定的な結果ではありません）。" % item)
    info("測れなかった理由: %s" % reason)
    info("測るには: %s" % howto)
    add_undetermined(item, reason, howto)


# ------------------------------------------------------------------------------
# Chat 呼び出し（max_tokens / max_completion_tokens の自動切替つき）
# ------------------------------------------------------------------------------

TOKEN_PARAM_STATE: dict = {}


def preferred_token_param(model: str) -> str:
    """本番コードの推測ロジックと同じもの。

    src/features/ai-answer/lib/llm/openaiCompatibleClient.ts の preferredTokenParam を移植。
    ここでの推測が実測と一致していれば、本番では余計な往復が発生しない。
    """
    name = model[model.rfind("/") + 1:]
    return "max_completion_tokens" if re.match(r"^(gpt-5|o[1-9])", name) else "max_tokens"


def is_unsupported_token_param(res: dict, sent: str) -> bool:
    """その 400 が「いま送った上限パラメータが非対応」を意味するか。

    単なる 400 で再試行して二重課金しないよう、パラメータ名が名指しされているかまで見る。
    "Use 'max_completion_tokens' instead." の**提案側**を拾わないことが重要。
    """
    if res.get("status") != 400:
        return False
    err = (res.get("json") or {}).get("error") or {}
    if err.get("param") == sent:
        return True
    msg = str(err.get("message", "")) or (res.get("text") or "")
    if ("parameter: '%s'" % sent) in msg:
        return True
    if ("'%s' is not supported" % sent) in msg or ("'%s' is unsupported" % sent) in msg:
        return True
    # OpenAI 以外のゲートウェイ向けの緩い判定（名指し + 非対応の語）
    low = msg.lower()
    return ("'%s'" % sent) in msg and ("unsupported" in low or "not supported" in low)


def track_usage(model: str, usage: dict) -> None:
    if not usage:
        return
    slot = USAGE_BY_MODEL.setdefault(model, {"prompt": 0, "completion": 0})
    slot["prompt"] += int(usage.get("prompt_tokens") or 0)
    slot["completion"] += int(usage.get("completion_tokens") or 0)


def chat(model: str, content, max_out: int, key: str, base: str,
         extra: dict = None, timeout: int = 180) -> dict:
    """1 回の Chat Completions 呼び出し。返り値に切替が起きたかを含める."""
    messages = [{"role": "user", "content": content}]

    def send(param: str) -> dict:
        body = {"model": model, "messages": messages, param: max_out}
        if extra:
            body.update(extra)
        return http_json("POST", base + "/chat/completions", key, body, timeout)

    first = TOKEN_PARAM_STATE.get(model) or preferred_token_param(model)
    res = send(first)
    swapped = False
    used = first
    if is_unsupported_token_param(res, first):
        used = "max_completion_tokens" if first == "max_tokens" else "max_tokens"
        res = send(used)
        swapped = True
    if res.get("status") == 200:
        TOKEN_PARAM_STATE[model] = used
        track_usage(model, (res.get("json") or {}).get("usage") or {})
    return {"res": res, "token_param": used, "first_param": first, "swapped": swapped}


def text_part(s: str) -> dict:
    return {"type": "text", "text": s}


def image_part(url: str, detail=None) -> dict:
    iu = {"url": url}
    if detail is not None:
        iu["detail"] = detail
    return {"type": "image_url", "image_url": iu}


def usage_of(res: dict) -> dict:
    return ((res.get("json") or {}).get("usage") or {})


def content_of(res: dict) -> str:
    choices = (res.get("json") or {}).get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message") or {}).get("content") or ""


def finish_of(res: dict):
    choices = (res.get("json") or {}).get("choices") or []
    return choices[0].get("finish_reason") if choices else None


def reasoning_tokens_of(usage: dict):
    """reasoning_tokens。フィールド自体が無い場合は None（= 0 と区別する）."""
    det = usage.get("completion_tokens_details")
    if not isinstance(det, dict):
        return None
    val = det.get("reasoning_tokens")
    return None if val is None else int(val)


def cached_tokens_of(usage: dict):
    det = usage.get("prompt_tokens_details")
    if not isinstance(det, dict):
        return None
    val = det.get("cached_tokens")
    return None if val is None else int(val)


# ------------------------------------------------------------------------------
# 各チェック
# ------------------------------------------------------------------------------

MEASURE_TEXT = "\u3053\u306e\u753b\u50cf\u306e\u8272\u3092\u6f22\u5b57\u4e00\u6587\u5b57\u3067\u7b54\u3048\u3066\u304f\u3060\u3055\u3044\u3002"
# = 「この画像の色を漢字一文字で答えてください。」
# 計測系はすべてこの同じ文言を使う。テキスト分のトークンが相殺されて、差分がそのまま画像分になる。


def check_auth(cfg: dict) -> dict:
    hr("\u2460 \u8a8d\u8a3c\uff08GET /models\uff09")
    res = http_json("GET", cfg["base"] + "/models", cfg["key"], None, 60)
    out = {"http": res["status"], "ms": res["ms"]}
    if res["status"] == 401:
        ng("401 Unauthorized\u3002API \u30ad\u30fc\u304c\u7121\u52b9\u3067\u3059\u3002")
        info(api_error(res))
        note("\u3053\u3053\u304c\u901a\u3089\u306a\u3044\u3068\u4ed6\u306e\u5168\u3066\u304c\u610f\u5473\u3092\u6301\u305f\u306a\u3044\u306e\u3067\u4e2d\u65ad\u3057\u307e\u3059\u3002"
             "\u30ad\u30fc\u306e\u518d\u767a\u884c\u304b\u3001\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u9055\u3044\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "fail"
        RESULT["checks"]["auth"] = out
        return out
    if res["status"] == 0:
        ng("\u30b5\u30fc\u30d0\u30fc\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3002")
        info(api_error(res))
        note("LLM_BASE_URL\uff08%s\uff09\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
             "\u672b\u5c3e\u306f /v1 \u307e\u3067\u3067\u3001\u30b9\u30e9\u30c3\u30b7\u30e5\u306a\u3057\u304c\u6b63\u3057\u3044\u5f62\u3067\u3059"
             "\uff08\u4f8b: https://api.openai.com/v1\uff09\u3002\u63a5\u7d9a\u3067\u304d\u306a\u3044\u9593\u306f\u4ed6\u306e\u30c1\u30a7\u30c3\u30af\u3082\u5168\u90e8\u5931\u6557\u3059\u308b\u306e\u3067\u4e2d\u65ad\u3057\u307e\u3059\u3002" % cfg["base"])
        add_undetermined("すべてのチェック（サーバーに接続できないため 1 つも実行していません）",
                         undetermined_reason(res), undetermined_howto(res))
        out["status"] = V_UNDETERMINED
        RESULT["checks"]["auth"] = out
        return out
    if res["status"] != 200:
        note_quota_once(res)
        warn("HTTP %s\u3002/models \u306f\u4f7f\u3048\u307e\u305b\u3093\u304c\u3001\u4ed6\u306e\u30c1\u30a7\u30c3\u30af\u306f\u7d9a\u884c\u3057\u307e\u3059\u3002" % res["status"])
        info(api_error(res))
        note("\u4e00\u90e8\u306e\u30b2\u30fc\u30c8\u30a6\u30a7\u30a4\u306f /models \u3092\u516c\u958b\u3057\u307e\u305b\u3093\u3002\u2462 \u306e\u5b9f\u547c\u3073\u51fa\u3057\u304c\u672c\u756a\u306e\u5224\u5b9a\u3067\u3059\u3002")
        out["status"] = "warn"
        RESULT["checks"]["auth"] = out
        return out
    ids = [m.get("id") for m in ((res["json"] or {}).get("data") or []) if m.get("id")]
    out["model_count"] = len(ids)
    out["status"] = "ok"
    out["_ids"] = ids
    ok("\u8a8d\u8a3c OK\uff08%d ms\uff09\u3002\u3053\u306e\u30ad\u30fc\u3067 %d \u4ef6\u306e\u30e2\u30c7\u30eb\u304c\u898b\u3048\u307e\u3059\u3002" % (res["ms"], len(ids)))
    note("\u30ad\u30fc\u304c\u6709\u52b9\u3067\u3001\u30d9\u30fc\u30b9 URL\uff08%s\uff09\u3082\u6b63\u3057\u3044\u3068\u3044\u3046\u3053\u3068\u3067\u3059\u3002" % cfg["base"])
    RESULT["checks"]["auth"] = {k: v for k, v in out.items() if not k.startswith("_")}
    return out


def check_models(cfg: dict, ids: list) -> dict:
    hr("\u2461 \u30e2\u30c7\u30eb\u5b9f\u5728\u78ba\u8a8d")
    out = {"status": "skip"}
    if ids is None:
        warn("/models \u304c\u53d6\u5f97\u3067\u304d\u306a\u304b\u3063\u305f\u305f\u3081\u3001\u4e00\u89a7\u306b\u3088\u308b\u78ba\u8a8d\u306f\u30b9\u30ad\u30c3\u30d7\u3057\u307e\u3059\u3002")
        note("\u2462\u2463 \u306e\u5b9f\u547c\u3073\u51fa\u3057\u304c\u901a\u308c\u3070 ID \u306f\u6b63\u3057\u3044\u3068\u5224\u65ad\u3057\u3066\u554f\u984c\u3042\u308a\u307e\u305b\u3093\u3002")
        RESULT["checks"]["models_exist"] = out
        return out

    buckets = {
        "gpt-5 \u7cfb": [i for i in ids if i.startswith("gpt-5")],
        "luna / terra / sol": [i for i in ids if re.search(r"luna|terra|sol", i)],
        "gpt-4o \u7cfb": [i for i in ids if i.startswith("gpt-4o")],
        "embedding \u7cfb": [i for i in ids if "embedding" in i],
    }
    for name, lst in buckets.items():
        if lst:
            print("  [%s] %d \u4ef6" % (name, len(lst)))
            for i in sorted(lst)[:40]:
                info(i)
            if len(lst) > 40:
                info("... \u4ed6 %d \u4ef6" % (len(lst) - 40))
        else:
            print("  [%s] 0 \u4ef6" % name)
    others = len(ids) - len(set(sum(buckets.values(), [])))
    print("  [\u305d\u306e\u4ed6] %d \u4ef6\uff08\u4eca\u56de\u306e\u5224\u65ad\u306b\u306f\u4f7f\u3044\u307e\u305b\u3093\uff09" % others)
    print("")

    listed = {}
    for label, model in (("default", cfg["model_default"]),
                         ("complex", cfg["model_complex"]),
                         ("embedding", cfg["embedding_model"])):
        present = model in ids
        listed[label] = present
        if present:
            ok("%s = %s \u306f\u4e00\u89a7\u306b\u3042\u308a\u307e\u3059\u3002" % (label.upper(), model))
        else:
            warn("%s = %s \u306f\u4e00\u89a7\u306b\u3042\u308a\u307e\u305b\u3093\u3002" % (label.upper(), model))
            key = re.sub(r"[^a-z0-9]", "", model.lower())[:6]
            near = [i for i in ids if key and key[:4] in re.sub(r"[^a-z0-9]", "", i.lower())]
            if near:
                info("\u4f3c\u305f ID \u306e\u5019\u88dc: " + ", ".join(sorted(near)[:10])) 
            else:
                info("\u4f3c\u305f ID \u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
    note("\u3053\u3053\u3067 \u26a0\ufe0f \u304c\u51fa\u3066\u3082\u3001\u2462\u2463 \u306e\u547c\u3073\u51fa\u3057\u304c\u901a\u308c\u3070\u4f7f\u3048\u307e\u3059"
         "\uff08\u4e00\u89a7\u306b\u51fa\u306a\u3044\u3060\u3051\u306e\u30e2\u30c7\u30eb\u304c\u3042\u308b\u305f\u3081\uff09\u3002"
         "\u901a\u3089\u306a\u304b\u3063\u305f\u3068\u304d\u306f\u4e0a\u306e\u300c\u5019\u88dc\u300d\u304b\u3089\u9078\u3073\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
    out = {"status": "ok" if all(listed.values()) else "warn", "listed": listed,
           "counts": {k: len(v) for k, v in buckets.items()}}
    RESULT["checks"]["models_exist"] = out
    return out


def check_chat(cfg: dict, label: str, model: str) -> dict:
    hr("\u2462 Chat\uff08%s = %s\uff09" % (label, model))
    out = {"model": model, "status": "fail"}
    prompt = "\u4e2d\u5b66 3 \u5e74\u751f\u306b\u5411\u3051\u3066\u3001\u4e09\u5e73\u65b9\u306e\u5b9a\u7406\u3092 3 \u884c\u3067\u8aac\u660e\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
    r = chat(model, [text_part(prompt)], TUTOR_MAX_TOKENS, cfg["key"], cfg["base"])
    res = r["res"]
    out["token_param_used"] = r["token_param"]
    out["token_param_guess"] = r["first_param"]
    out["auto_retried"] = r["swapped"]

    # --- 出力上限パラメータの切替が起きたか（コード修正の要否に直結する） ---
    if r["swapped"]:
        warn("\u3010\u81ea\u52d5\u518d\u8a66\u884c\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3011"
             "%s \u304c 400 \u3067\u62d2\u5426\u3055\u308c\u3001%s \u3067\u518d\u9001\u3057\u307e\u3057\u305f\u3002"
             % (r["first_param"], r["token_param"]))
        note("\u672c\u756a\u30b3\u30fc\u30c9\u306e\u63a8\u6e2c\uff08preferredTokenParam\uff09\u304c\u5916\u308c\u3066\u3044\u307e\u3059\u3002"
             "\u52d5\u4f5c\u306f\u3057\u307e\u3059\u304c\u3001\u6bce\u56de 1 \u5f80\u5fa9\u7121\u99c4\u306b\u306a\u308a\u307e\u3059\u3002")
        add_code_change(
            TOKEN_PARAM_FIX,
            "%s \u306f %s \u3092\u8fd4\u3059\u3079\u304d\uff08\u73fe\u5728\u306e\u63a8\u6e2c\u306f %s\uff09"
            % (model, r["token_param"], r["first_param"]))
    elif res["status"] == 200:
        ok("\u51fa\u529b\u4e0a\u9650\u306e\u30d1\u30e9\u30e1\u30fc\u30bf\u306f %s \u3067\u305d\u306e\u307e\u307e\u901a\u308a\u307e\u3057\u305f\uff08\u518d\u8a66\u884c\u306a\u3057\uff09\u3002"
           % r["token_param"])
        note("\u672c\u756a\u30b3\u30fc\u30c9\u306e\u63a8\u6e2c\u3068\u4e00\u81f4\u3057\u3066\u3044\u308b\u306e\u3067\u3001\u3053\u306e\u70b9\u306e\u30b3\u30fc\u30c9\u4fee\u6b63\u306f\u4e0d\u8981\u3067\u3059\u3002")
    else:
        warn("\u51fa\u529b\u4e0a\u9650\u306e\u30d1\u30e9\u30e1\u30fc\u30bf\uff08%s\uff09\u306e\u53ef\u5426\u306f\u5224\u5b9a\u3067\u304d\u307e\u305b\u3093\u3002"
             "\u547c\u3073\u51fa\u3057\u81ea\u4f53\u304c\u5225\u306e\u7406\u7531\u3067\u5931\u6557\u3057\u3066\u3044\u307e\u3059\uff08\u4e0b\u53c2\u7167\uff09\u3002" % r["token_param"])

    if res["status"] != 200:
        out["error"] = api_error(res)
        if is_undetermined_status(res):
            unk("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            note_quota_once(res)
            report_undetermined("%s = %s \u306e Chat \u5b9f\u547c\u3073\u51fa\u3057" % (label, model), res)
            note("\u3053\u306e\u30e2\u30c7\u30eb\u304c\u4f7f\u3048\u306a\u3044\u3068\u6c7a\u307e\u3063\u305f\u308f\u3051\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u4e0a\u306e\u7406\u7531\u3092\u89e3\u6d88\u3059\u308c\u3070\u6e2c\u5b9a\u3067\u304d\u307e\u3059\u3002")
            out["status"] = V_UNDETERMINED
        else:
            ng("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            if res["status"] == 404 or "model" in (api_error(res) or "").lower():
                note("\u30e2\u30c7\u30eb ID \u304c\u9055\u3046\u53ef\u80fd\u6027\u304c\u9ad8\u3044\u3067\u3059\u3002\u2461 \u306e\u4e00\u89a7\u304b\u3089\u6b63\u3057\u3044 ID \u3092\u63a2\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
            out["status"] = "fail"
        RESULT["checks"].setdefault("chat", {})[label] = out
        return out

    usage = usage_of(res)
    body = content_of(res)
    fin = finish_of(res)
    rt = reasoning_tokens_of(usage)
    ct = cached_tokens_of(usage)
    out.update({
        "http": 200, "ms": res["ms"],
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "reasoning_tokens": rt, "cached_tokens": ct,
        "finish_reason": fin,
        "returned_model": (res["json"] or {}).get("model"),
        "empty": not body.strip(),
    })

    print("  \u3010\u5fdc\u7b54\u672c\u6587\u3011")
    if body.strip():
        for line in body.strip().splitlines()[:6]:
            info(line[:120])
    else:
        info("\uff08\u7a7a\uff09")
    print("")
    info("usage: prompt=%s / completion=%s / total=%s"
         % (usage.get("prompt_tokens"), usage.get("completion_tokens"), usage.get("total_tokens")))
    info("finish_reason: %s   \u5fdc\u7b54\u6642\u9593: %d ms" % (fin, res["ms"]))
    info("returned model: %s" % ((res["json"] or {}).get("model")))
    info("reasoning_tokens: %s" % ("\u672a\u5831\u544a\uff08\u30d5\u30a3\u30fc\u30eb\u30c9\u306a\u3057\uff09" if rt is None else rt))
    info("cached_tokens: %s" % ("\u672a\u5831\u544a" if ct is None else ct))
    print("")

    if not body.strip():
        ng("\u5fdc\u7b54\u672c\u6587\u304c\u7a7a\u3067\u3059\u3002")
        note("\u672c\u756a\u3067\u306f\u3053\u308c\u304c AiResponseFailedError \u306b\u306a\u308a\u3001\u751f\u5f92\u306b\u306f AI_RESPONSE_FAILED \u304c\u8fd4\u308a\u307e\u3059\u3002"
             "reasoning \u304c\u51fa\u529b\u67a0\u3092\u98df\u3044\u5207\u3063\u3066\u3044\u308b\u306e\u304c\u5178\u578b\u4f8b\u3067\u3059\u3002")
        out["status"] = "fail"
    elif fin == "length":
        warn("finish_reason \u304c length \u3067\u3059\uff08\u4e0a\u9650 %d \u3067\u6253\u3061\u5207\u3089\u308c\u305f\uff09\u3002" % TUTOR_MAX_TOKENS)
        note("\u4e0a\u9650\u304c\u52b9\u3044\u3066\u3044\u308b\u8a3c\u62e0\u3067\u3082\u3042\u308a\u307e\u3059\u3002\u77ed\u3044\u8cea\u554f\u3067\u3053\u308c\u304c\u51fa\u308b\u306a\u3089 reasoning \u306e\u6d88\u8cbb\u3092\u7591\u3063\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "warn"
    else:
        ok("\u5fdc\u7b54\u672c\u6587\u304c\u8fd4\u308a\u307e\u3057\u305f\u3002")
        out["status"] = "ok"

    if rt is None:
        warn("reasoning_tokens \u304c usage \u306b\u542b\u307e\u308c\u3066\u3044\u307e\u305b\u3093\u3002")
        note("\u300creasoning \u304c OFF\u300d\u3068\u306f\u65ad\u5b9a\u3067\u304d\u307e\u305b\u3093\u3002completion_tokens \u3068\u672c\u6587\u306e\u9577\u3055\u304c"
             "\u898b\u5408\u3063\u3066\u3044\u308c\u3070 OFF \u3068\u307f\u3066\u3088\u3044\u3067\u3059\u3002")
    elif rt == 0:
        ok("reasoning_tokens = 0\u3002\u601d\u8003\u30c8\u30fc\u30af\u30f3\u306f\u6d88\u8cbb\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002")
        note("\u65e2\u5b9a\u3067 reasoning \u304c OFF \u3068\u3044\u3046\u3053\u3068\u3067\u3059\u3002reasoning \u3092\u5207\u308b\u30b3\u30fc\u30c9\u5909\u66f4\uff08\u6c7a\u5b9a\u4e8b\u9805 \u00a73-3\uff09\u306f\u4e0d\u8981\u3067\u3059\u3002")
    else:
        pct = 100.0 * rt / TUTOR_MAX_TOKENS
        if pct > 30:
            ng("reasoning_tokens = %d\uff08\u51fa\u529b\u4e0a\u9650 %d \u306e %.0f%%\uff09\u3002" % (rt, TUTOR_MAX_TOKENS, pct))
            note("\u51fa\u529b\u67a0\u306e 3 \u5272\u8d85\u3092\u601d\u8003\u306b\u53d6\u3089\u308c\u3066\u3044\u307e\u3059\u3002\u8981\u7d04\uff08\u4e0a\u9650 400\uff09\u306f\u5b9f\u8cea\u7834\u7dbb\u3057\u307e\u3059\u3002"
                 "reasoning \u3092\u5207\u308b\u5b9f\u88c5\u304c\u5fc5\u9808\u3067\u3059\u3002")
            add_code_change(
                REASONING_FIX,
                "%s: reasoning_tokens=%d\uff08\u51fa\u529b\u4e0a\u9650\u306e %.0f%%\u3002\u56de\u7b54\u304c\u58ca\u308c\u308b\u6c34\u6e96\uff09" % (model, rt, pct))
        else:
            warn("reasoning_tokens = %d\uff08\u51fa\u529b\u4e0a\u9650 %d \u306e %.0f%%\uff09\u3002" % (rt, TUTOR_MAX_TOKENS, pct))
            note("3 \u5272\u4ee5\u4e0b\u306a\u306e\u3067\u56de\u7b54\u306f\u58ca\u308c\u307e\u305b\u3093\u304c\u3001reasoning \u306f\u51fa\u529b\u5358\u4fa1\u3067\u8ab2\u91d1\u3055\u308c\u307e\u3059\u3002"
                 "\u30e2\u30c7\u30eb\u66f4\u65b0\u3067\u5897\u3048\u308b\u3053\u3068\u304c\u3042\u308b\u306e\u3067\u76e3\u8996\u5bfe\u8c61\u306b\u6b8b\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
            add_code_change(
                REASONING_FIX,
                "%s: reasoning_tokens=%d\uff08\u51fa\u529b\u4e0a\u9650\u306e %.0f%%\u3002\u56de\u7b54\u306f\u58ca\u308c\u306a\u3044\u304c\u8ab2\u91d1\u3055\u308c\u308b\uff09" % (model, rt, pct))

    if ct is not None and ct > 0:
        ok("cached_tokens = %d\u3002\u30d7\u30ed\u30f3\u30d7\u30c8\u30ad\u30e3\u30c3\u30b7\u30e5\u304c\u52b9\u3044\u3066\u3044\u307e\u3059\uff08\u5165\u529b\u5358\u4fa1 1/10\uff09\u3002" % ct)

    RESULT["checks"].setdefault("chat", {})[label] = out
    return out


def check_reasoning_off(cfg: dict, model: str) -> dict:
    """reasoning が動いていた場合のみ、どう書けば切れるかを実測で特定する."""
    hr("\u2462-b reasoning \u3092\u5207\u308b\u65b9\u6cd5\u306e\u7279\u5b9a\uff08%s\uff09" % model)
    prompt = "1 \u304b\u3089 5 \u307e\u3067\u3092\u8db3\u3057\u305f\u7b54\u3048\u3092\u6570\u5b57\u3060\u3051\u3067\u7b54\u3048\u3066\u304f\u3060\u3055\u3044\u3002"
    candidates = [
        ("reasoning_effort='none'", {"reasoning_effort": "none"}),
        ("reasoning_effort='minimal'", {"reasoning_effort": "minimal"}),
        ("reasoning_effort='low'", {"reasoning_effort": "low"}),
        ("reasoning={'effort':'none'}", {"reasoning": {"effort": "none"}}),
    ]
    found = None
    rows = []
    last_bad = None
    for name, extra in candidates:
        r = chat(model, [text_part(prompt)], TUTOR_MAX_TOKENS, cfg["key"], cfg["base"], extra=extra)
        res = r["res"]
        if res["status"] != 200:
            verdict = classify_result(res, keywords=("reasoning",))
            rows.append({"param": name, "verdict": verdict, "error": api_error(res)[:160]})
            last_bad = res
            if verdict == V_UNDETERMINED:
                unk("%-32s \u2192 HTTP %s: %s" % (name, res["status"], api_error(res)[:100]))
                info("      \u3053\u306e\u66f8\u304d\u65b9\u304c\u4f7f\u3048\u306a\u3044\u3068\u3044\u3046\u610f\u5473\u3067\u306f\u3042\u308a\u307e\u305b\u3093\uff08\u6e2c\u5b9a\u3067\u304d\u3066\u3044\u306a\u3044\u3060\u3051\uff09\u3002")
            else:
                ng("%-32s \u2192 HTTP %s: %s" % (name, res["status"], api_error(res)[:100]))
            continue
        u = usage_of(res)
        rt = reasoning_tokens_of(u)
        body = content_of(res)
        rows.append({"param": name, "verdict": V_SUPPORTED, "reasoning_tokens": rt,
                     "completion_tokens": u.get("completion_tokens"), "empty": not body.strip()})
        if rt == 0 and body.strip():
            ok("%-32s \u2192 \u53d7\u4ed8 OK / reasoning_tokens=0 / \u672c\u6587\u3042\u308a" % name)
            if found is None:
                found = name
        else:
            warn("%-32s \u2192 \u53d7\u4ed8\u3055\u308c\u305f\u304c reasoning_tokens=%s\uff08\u672c\u6587%s\uff09"
                 % (name, rt, "\u3042\u308a" if body.strip() else "\u306a\u3057"))
        if found:
            break
    print("")
    if found:
        ok("reasoning \u306f \u300c%s\u300d \u3092\u9001\u308c\u3070\u5207\u308c\u307e\u3059\u3002" % found)
        note("\u3053\u306e 1 \u884c\u3092 openaiCompatibleClient.ts \u306e chat.completions.create() \u306b\u8ffd\u52a0\u3059\u308c\u3070\u5bfe\u5fdc\u5b8c\u4e86\u3067\u3059\u3002")
        add_code_change(
            REASONING_FIX,
            "\u5b9f\u6e2c\u3067\u52b9\u3044\u305f\u66f8\u304d\u65b9: %s \u3092 create() \u306b\u8ffd\u52a0\u3059\u308b" % found)
    elif all(r.get("verdict") == V_UNDETERMINED for r in rows):
        report_undetermined("reasoning \u3092\u5207\u308b\u30d1\u30e9\u30e1\u30fc\u30bf\u306e\u7279\u5b9a", last_bad or {"status": None})
        note("\u8a66\u3057\u305f 4 \u901a\u308a\u304c\u3059\u3079\u3066\u8a55\u4fa1\u3055\u308c\u306a\u304b\u3063\u305f\u305f\u3081\u3001\u300c\u5207\u308c\u306a\u3044\u300d\u3068\u3082\u300c\u5207\u308c\u308b\u300d\u3068\u3082\u8a00\u3048\u307e\u305b\u3093\u3002")
        out = {"status": V_UNDETERMINED, "working_param": None, "tried": rows}
        RESULT["checks"]["reasoning_off"] = out
        return out
    else:
        ng("\u8a66\u3057\u305f 4 \u901a\u308a\u3067\u306f reasoning \u3092\u5207\u308c\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
        note("\u5207\u308c\u306a\u3044\u5834\u5408\u306f\u3001\u51fa\u529b\u4e0a\u9650\uff08TUTOR_MAX_TOKENS / SUMMARY_MAX_TOKENS\uff09\u3092"
             "reasoning \u5206\u3060\u3051\u5f15\u304d\u4e0a\u3052\u308b\u306e\u304c\u4ee3\u66ff\u7b56\u3067\u3059\u3002")
        add_code_change(
            REASONING_FIX,
            "\u30d1\u30e9\u30e1\u30fc\u30bf\u3067\u306f\u5207\u308c\u306a\u304b\u3063\u305f\u3002"
            "\u4ee3\u66ff\u7b56\u3068\u3057\u3066 SUMMARY_MAX_TOKENS(400) \u3092\u5f15\u304d\u4e0a\u3052\u308b"
            "\uff08src/shared/lib/constants.ts\uff09")
    out = {"status": "ok" if found else "fail", "working_param": found, "tried": rows}
    RESULT["checks"]["reasoning_off"] = out
    return out


def measure_prompt_tokens(cfg: dict, model: str, parts: list, label: str) -> dict:
    """prompt_tokens だけを見る計測用呼び出し（本文は不要なので出力上限を最小にする）."""
    r = chat(model, parts, MEASURE_MAX_TOKENS, cfg["key"], cfg["base"])
    res = r["res"]
    if res["status"] == 400 and not r["swapped"]:
        # 出力上限が小さすぎて弾かれるモデルがあるため 1 度だけ引き上げて再試行する
        r = chat(model, parts, TUTOR_MAX_TOKENS, cfg["key"], cfg["base"])
        res = r["res"]
    if res["status"] != 200:
        note_quota_once(res)
        return {"label": label, "ok": False, "http": res["status"],
                "error": api_error(res), "res": res}
    u = usage_of(res)
    return {"label": label, "ok": True, "prompt_tokens": int(u.get("prompt_tokens") or 0),
            "ms": res["ms"], "content": content_of(res), "res": res}


def check_vision(cfg: dict, model: str) -> dict:
    hr("\u2463 Vision\uff0864x64 \u306e\u8d64\u3044 PNG \u3092\u5b9f\u884c\u6642\u306b\u751f\u6210\u3057\u3066\u9001\u4fe1\uff09")
    png = make_png(64)
    info("\u751f\u6210\u3057\u305f PNG: 64x64 / %d \u30d0\u30a4\u30c8 / RGB(255,0,0) \u5358\u8272" % len(png))
    url = data_url(png, "image/png")

    base = measure_prompt_tokens(cfg, model, [text_part(MEASURE_TEXT)], "text-only")
    if base["ok"]:
        info("\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\uff08\u540c\u3058\u6587\u8a00\u3092\u753b\u50cf\u306a\u3057\u3067\u9001\u3063\u305f\u5834\u5408\uff09: prompt_tokens=%d" % base["prompt_tokens"])
    else:
        warn("\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\u306e\u53d6\u5f97\u306b\u5931\u6557\uff1a%s" % base.get("error"))
        info("\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\u304c\u7121\u3044\u3068\u753b\u50cf 1 \u679a\u5206\u306e\u30c8\u30fc\u30af\u30f3\u6570\uff08\u2465\u2466\u2467 \u306e\u6bd4\u8f03\u306e\u571f\u53f0\uff09\u304c\u51fa\u305b\u307e\u305b\u3093\u3002")

    r = chat(model, [text_part(MEASURE_TEXT), image_part(url)], TUTOR_MAX_TOKENS, cfg["key"], cfg["base"])
    res = r["res"]
    out = {"status": "fail", "model": model, "png_bytes": len(png),
           "baseline_prompt_tokens": base.get("prompt_tokens")}

    if res["status"] != 200:
        out["error"] = api_error(res)
        if is_undetermined_status(res):
            unk("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            note_quota_once(res)
            report_undetermined("Vision\uff08\u753b\u50cf\u5165\u529b\uff09\u304c\u4f7f\u3048\u308b\u304b", res)
            note("Vision \u975e\u5bfe\u5fdc\u3068\u6c7a\u307e\u3063\u305f\u308f\u3051\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u753b\u50cf\u306f\u8a55\u4fa1\u3059\u3089\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002")
            out["status"] = V_UNDETERMINED
        else:
            ng("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            msg = api_error(res).lower()
            if "image" in msg:
                note("\u753b\u50cf\u5165\u529b\u81ea\u4f53\u304c\u62d2\u5426\u3055\u308c\u3066\u3044\u307e\u3059\u3002\u3053\u306e\u30e2\u30c7\u30eb\u306f Vision \u975e\u5bfe\u5fdc\u306e\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002"
                     "\u9001\u3063\u305f PNG \u306f\u30ed\u30fc\u30ab\u30eb\u691c\u8a3c\u6e08\u307f\u306e\u751f\u6210\u5668\u306a\u306e\u3067\u3001\u58ca\u308c\u305f\u753b\u50cf\u304c\u539f\u56e0\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002")
        RESULT["checks"]["vision"] = out
        return out

    body = content_of(res)
    fin = finish_of(res)
    u = usage_of(res)
    if not body.strip() and fin == "length":
        warn("\u672c\u6587\u304c\u7a7a\u3067 finish_reason=length\u3002\u51fa\u529b\u67a0\u3092 4000 \u306b\u5e83\u3052\u3066 1 \u5ea6\u3060\u3051\u518d\u8a66\u884c\u3057\u307e\u3059\u3002")
        r = chat(model, [text_part(MEASURE_TEXT), image_part(url)], 4000, cfg["key"], cfg["base"])
        if r["res"]["status"] == 200:
            res = r["res"]
            body = content_of(res)
            fin = finish_of(res)
            u = usage_of(res)

    pt = int(u.get("prompt_tokens") or 0)
    out.update({"http": 200, "prompt_tokens": pt, "finish_reason": fin,
                "answer": body.strip()[:200]})
    print("")
    info("\u5fdc\u7b54: %s" % (body.strip()[:100] or "\uff08\u7a7a\uff09"))
    info("usage: prompt=%s / completion=%s / finish_reason=%s" % (pt, u.get("completion_tokens"), fin))

    if base["ok"]:
        delta = pt - base["prompt_tokens"]
        out["image_tokens"] = delta
        info("\u753b\u50cf 1 \u679a\u5206\u306e\u30c8\u30fc\u30af\u30f3\u6570 = %d - %d = **%d**" % (pt, base["prompt_tokens"], delta))
        note("\u3053\u308c\u304c\u30b3\u30b9\u30c8\u8a66\u7b97\u306e\u6700\u5927\u306e\u4e0d\u78ba\u5b9f\u8981\u7d20\u3060\u3063\u305f\u6570\u5024\u3067\u3059\uff08\u6c7a\u5b9a\u4e8b\u9805 \u00a74-1 \u306e\u4eee\u5024 1,500\uff09\u3002")

    if "\u8d64" in body:
        ok("\u300c\u8d64\u300d\u3068\u7b54\u3048\u307e\u3057\u305f\u3002Vision \u306f\u5b9f\u969b\u306b\u52d5\u3044\u3066\u3044\u307e\u3059\u3002")
        note("\u753b\u50cf\u4ed8\u304d\u8cea\u554f\u304c\u672c\u756a\u3067\u52d5\u304f\u3053\u3068\u306e\u76f4\u63a5\u7684\u306a\u8a3c\u62e0\u3067\u3059\u3002")
        out["status"] = "ok"
    elif body.strip():
        warn("\u5fdc\u7b54\u306f\u8fd4\u3063\u305f\u3082\u306e\u306e\u300c\u8d64\u300d\u304c\u542b\u307e\u308c\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
        note("\u753b\u50cf\u306f\u5c4a\u3044\u3066\u3044\u308b\u304c\u8aad\u3081\u3066\u3044\u306a\u3044\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002\u4e0a\u306e\u5fdc\u7b54\u5185\u5bb9\u3092\u76ee\u3067\u898b\u3066\u5224\u65ad\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "warn"
    else:
        ng("\u5fdc\u7b54\u672c\u6587\u304c\u7a7a\u3067\u3059\uff08finish_reason=%s\uff09\u3002" % fin)
        note("reasoning \u304c\u51fa\u529b\u67a0\u3092\u98df\u3044\u5207\u3063\u3066\u3044\u308b\u53ef\u80fd\u6027\u304c\u9ad8\u3044\u3067\u3059\u3002\u2462-b \u306e\u7d50\u679c\u3092\u898b\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "fail"

    RESULT["checks"]["vision"] = out
    return out


def check_embedding(cfg: dict) -> dict:
    hr("\u2464 Embedding\uff08%s\uff09" % cfg["embedding_model"])
    body = {"model": cfg["embedding_model"],
            "input": "\u4e09\u5e73\u65b9\u306e\u5b9a\u7406\u306b\u3064\u3044\u3066\u6559\u3048\u3066\u304f\u3060\u3055\u3044",
            "encoding_format": "float"}
    res = http_json("POST", cfg["embedding_base"] + "/embeddings", cfg["embedding_key"], body, 120)
    out = {"status": "fail", "model": cfg["embedding_model"], "http": res["status"]}
    if res["status"] != 200:
        out["error"] = api_error(res)
        if is_undetermined_status(res):
            unk("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            note_quota_once(res)
            report_undetermined("Embedding\uff08\u6b21\u5143\u6570 %d \u304b / RAG \u304c\u4f7f\u3048\u308b\u304b\uff09" % EXPECTED_EMBEDDING_DIM, res)
            note("Embedding \u304c\u4f7f\u3048\u306a\u3044\u3068\u6c7a\u307e\u3063\u305f\u308f\u3051\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002EMBEDDING_* \u306e\u8a2d\u5b9a\u304c\u60aa\u3044\u3068\u3082\u8a00\u3048\u307e\u305b\u3093\u3002")
            out["status"] = V_UNDETERMINED
        else:
            ng("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            note("RAG\uff08\u904e\u53bb\u30ec\u30dd\u30fc\u30c8\u691c\u7d22\uff09\u304c\u4f7f\u3048\u307e\u305b\u3093\u3002EMBEDDING_* \u306e 3 \u3064\u3092\u898b\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
        RESULT["checks"]["embedding"] = out
        return out

    data = ((res["json"] or {}).get("data") or [])
    vec = (data[0].get("embedding") if data else None) or []
    dim = len(vec)
    track_usage(cfg["embedding_model"], (res["json"] or {}).get("usage") or {})
    out["dim"] = dim
    info("\u6b21\u5143\u6570: %d" % dim)
    info("\u5148\u982d 5 \u4ef6: %s" % ", ".join("%.5f" % v for v in vec[:5]))

    if dim == EXPECTED_EMBEDDING_DIM:
        ok("%d \u6b21\u5143\u3067\u3059\u3002" % dim)
        note("DB \u306e vector(%d) \u3068\u4e00\u81f4\u3057\u3066\u3044\u307e\u3059\u3002\u9055\u3046\u3068\u4fdd\u5b58\u6642\u306b\u30a8\u30e9\u30fc\u306b\u306a\u308a\u307e\u3059\u3002" % EXPECTED_EMBEDDING_DIM)
        out["status"] = "ok"
    else:
        ng("%d \u6b21\u5143\u3067\u3059\uff08\u671f\u5f85\u306f %d\uff09\u3002" % (dim, EXPECTED_EMBEDDING_DIM))
        note("\u3053\u306e\u307e\u307e\u3060\u3068 RAG \u304c\u4f7f\u3048\u307e\u305b\u3093\u3002\u30e2\u30c7\u30eb\u3092\u623b\u3059\u304b\u3001DB \u306e vector \u5217\u306e\u6b21\u5143\u3092\u5408\u308f\u305b\u308b\u5fc5\u8981\u304c\u3042\u308a\u307e\u3059\u3002")
        out["status"] = "fail"

    nonzero = any(abs(v) > 1e-12 for v in vec[:64])
    out["nonzero_head"] = nonzero
    if nonzero:
        ok("\u5148\u982d\u304c\u30bc\u30ed\u57cb\u3081\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002")
        note("\u30d9\u30af\u30c8\u30eb\u306e\u4e2d\u8eab\u304c\u5b9f\u969b\u306b\u5165\u3063\u3066\u3044\u308b\uff08\u30c0\u30df\u30fc\u5fdc\u7b54\u3067\u306f\u306a\u3044\uff09\u3068\u3044\u3046\u78ba\u8a8d\u3067\u3059\u3002")
    else:
        ng("\u5148\u982d\u304c\u3059\u3079\u3066\u30bc\u30ed\u3067\u3059\u3002")
        note("\u30d7\u30ed\u30ad\u30b7\u3084\u30e2\u30c3\u30af\u306b\u7e4b\u304c\u3063\u3066\u3044\u306a\u3044\u304b\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "fail"

    RESULT["checks"]["embedding"] = out
    return out


DETAIL_VARIANTS = [
    ("\u672a\u6307\u5b9a", None, "\u4eca\u306e\u672c\u756a\u30b3\u30fc\u30c9\u306e\u632f\u308b\u821e\u3044\uff08detail \u3092\u9001\u3063\u3066\u3044\u306a\u3044\uff09"),
    ("auto", "auto", "OpenAI \u516c\u5f0f\u4ed5\u69d8\u306e\u65e2\u5b9a\u5024\u3068\u3055\u308c\u308b\u5024"),
    ("low", "low", "512x512 \u306b\u7e2e\u5c0f\u3057\u3066\u51e6\u7406\u3059\u308b\u3068\u3055\u308c\u308b\u5024"),
    ("high", "high", "\u9ad8\u89e3\u50cf\u5ea6\u3067\u51e6\u7406\u3059\u308b\u3068\u3055\u308c\u308b\u5024"),
    ("original", "original", "\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u00a73-1 \u304c\u300c\u65e2\u5b9a\u300d\u3068\u66f8\u3044\u3066\u3044\u308b\u5024\uff08\u5b9f\u5728\u3059\u308b\u304b\u672a\u691c\u8a3c\uff09"),
]


def check_detail(cfg: dict, model: str, baseline: int) -> dict:
    hr("\u2465 detail \u30d1\u30e9\u30e1\u30fc\u30bf\u306e\u5b9f\u6319\u52d5\uff08512x512 \u306e\u540c\u3058\u753b\u50cf\u3067\u6bd4\u8f03\uff09")
    png = make_png(512)
    url = data_url(png, "image/png")
    info("\u751f\u6210\u3057\u305f PNG: 512x512 / %d \u30d0\u30a4\u30c8" % len(png))
    if baseline is None:
        warn("\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\uff08\u753b\u50cf\u306a\u3057\u306e prompt_tokens\uff09\u304c\u53d6\u308c\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u5dee\u5206\u306f\u51fa\u305b\u307e\u305b\u3093\u3002")
    print("")

    rows = {}
    bad_res = {}          # ラベル -> 失敗した HTTP 結果（判定不能の理由を出すため）
    last_bad = None
    for label, value, why in DETAIL_VARIANTS:
        parts = [text_part(MEASURE_TEXT), image_part(url, value)]
        m = measure_prompt_tokens(cfg, model, parts, label)
        if not m["ok"]:
            # \u300c\u672a\u6307\u5b9a\u300d\u306f detail \u3092\u9001\u3063\u3066\u3044\u306a\u3044\u306e\u3067\u3001detail \u3092\u7406\u7531\u306b\u62d2\u5426\u3055\u308c\u308b\u3053\u3068\u306f\u306a\u3044\u3002
            # \u753b\u50cf\u305d\u306e\u3082\u306e\u304c\u5f3e\u304b\u308c\u305f\u3068\u304d\u3060\u3051 rejected \u306b\u306a\u308b\u3002
            kw = ("image",) if value is None else ("detail",)
            verdict = classify_result(m["res"], keywords=kw)
            rows[label] = {"verdict": verdict, "http": m["http"], "error": m["error"]}
            bad_res[label] = m["res"]
            last_bad = m["res"]
            if verdict == V_UNDETERMINED:
                unk("detail=%s \u2192 HTTP %s : %s"
                    % (display_pad(label, 9), m["http"], (m["error"] or "")[:80]))
                info("      \u5224\u5b9a\u4e0d\u80fd\uff08\u3053\u306e\u5024\u304c\u4f7f\u3048\u308b\u304b\u3069\u3046\u304b\u306f\u5206\u304b\u3063\u3066\u3044\u307e\u305b\u3093\uff09")
            else:
                ng("detail=%s \u2192 \u62d2\u5426 / HTTP %s : %s"
                   % (display_pad(label, 9), m["http"], (m["error"] or "")[:80]))
                info("      %s" % why)
            continue
        delta = (m["prompt_tokens"] - baseline) if baseline is not None else None
        rows[label] = {"verdict": V_SUPPORTED, "prompt_tokens": m["prompt_tokens"],
                       "image_tokens": delta}
        ok("detail=%s \u2192 \u53d7\u4ed8 OK / prompt_tokens=%d / \u753b\u50cf\u5206=%s"
           % (display_pad(label, 9), m["prompt_tokens"], delta if delta is not None else "\u4e0d\u660e"))
        info("      %s" % why)

    print("")
    accepted = [k for k, v in rows.items() if v.get("verdict") == V_SUPPORTED]
    rejected = [k for k, v in rows.items() if v.get("verdict") == V_REJECTED]
    undet = [k for k, v in rows.items() if v.get("verdict") == V_UNDETERMINED]

    # 1 \u3064\u3082\u5224\u5b9a\u3067\u304d\u3066\u3044\u306a\u3044\u306a\u3089\u3001\u3053\u3053\u304b\u3089\u5148\u306e\u7d50\u8ad6\u306f\u4e00\u5207\u51fa\u3055\u306a\u3044\u3002
    # \uff08\u30af\u30ec\u30b8\u30c3\u30c8\u5207\u308c\u3067\u5168\u6ec5\u3057\u305f\u5b9f\u884c\u304c\u300c\u5168\u90e8\u62d2\u5426\u3055\u308c\u305f\u300d\u3068\u8aad\u3081\u3066\u3057\u307e\u3046\u4e8b\u6545\u306e\u518d\u767a\u9632\u6b62\uff09
    if not accepted and not rejected:
        report_undetermined("detail \u30d1\u30e9\u30e1\u30fc\u30bf\u306b\u6307\u5b9a\u3067\u304d\u308b\u5024", last_bad or {"status": None})
        note("\u8a66\u3057\u305f %d \u901a\u308a\uff08%s\uff09\u304c 1 \u3064\u3082\u8a55\u4fa1\u3055\u308c\u3066\u3044\u306a\u3044\u305f\u3081\u3001"
             "\u300c\u53d7\u3051\u4ed8\u3051\u3089\u308c\u305f\u300d\u3068\u3082\u300c\u62d2\u5426\u3055\u308c\u305f\u300d\u3068\u3082\u66f8\u3051\u307e\u305b\u3093\u3002"
             % (len(undet), ", ".join(undet)))
        note("\u7279\u306b `original` \u306b\u3064\u3044\u3066\u306f\u3001\u5b9f\u5728\u3059\u308b\u3068\u3082\u3057\u306a\u3044\u3068\u3082\u5224\u65ad\u3067\u304d\u3066\u3044\u307e\u305b\u3093\u3002"
             "\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306e\u8a18\u8ff0\u306f\u3053\u306e\u5b9f\u884c\u3092\u6839\u62e0\u306b\u5909\u66f4\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002")
        out = {"status": V_UNDETERMINED, "variants": rows,
               "accepted": [], "rejected": [], "undetermined": undet}
        RESULT["checks"]["detail"] = out
        return out

    info("\u53d7\u3051\u4ed8\u3051\u3089\u308c\u305f\u5024: %s" % (", ".join(accepted) or "\u306a\u3057"))
    info("\u62d2\u5426\u3055\u308c\u305f\u5024: %s" % (", ".join(rejected) or "\u306a\u3057"))
    if undet:
        info("\u5224\u5b9a\u3067\u304d\u306a\u304b\u3063\u305f\u5024: %s" % ", ".join(undet))
        info("  \u2191 \u62d2\u5426\u3055\u308c\u305f\u306e\u3067\u306f\u306a\u304f\u3001\u6e2c\u5b9a\u3067\u304d\u3066\u3044\u307e\u305b\u3093\u3002")

    if "original" in rejected:
        ng("`original` \u306f\u62d2\u5426\u3055\u308c\u307e\u3057\u305f\u3002")
        note("\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u00a73-1 / \u6c7a\u5b9a\u4e8b\u9805 \u00a73-1 \u306e\u300c\u65e2\u5b9a\u306f original\u300d\u3068\u3044\u3046\u8a18\u8ff0\u306f\u8aa4\u308a\u3067\u3059\u3002"
             "\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306e\u4fee\u6b63\u304c\u5fc5\u8981\u3067\u3059\u3002")
        add_doc_change("\u6c7a\u5b9a\u4e8b\u9805 \u00a73-1 \u3068\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u00a73-1 \u306e\u300c detail \u306e\u65e2\u5b9a\u306f original \u300d\u3068\u3044\u3046\u8a18\u8ff0\u3092\u524a\u9664\u3059\u308b\uff08\u5b9f\u6e2c\u3067\u62d2\u5426\uff09")
    elif "original" in accepted:
        warn("`original` \u306f\u53d7\u3051\u4ed8\u3051\u3089\u308c\u307e\u3057\u305f\u3002")
        note("\u305f\u3060\u3057\u672a\u77e5\u306e\u5024\u3092\u9ed9\u3063\u3066\u7121\u8996\u3059\u308b\u5b9f\u88c5\u3082\u3042\u308b\u306e\u3067\u3001\u4e0a\u306e\u30c8\u30fc\u30af\u30f3\u6570\u304c "
             "auto \u3068\u540c\u3058\u306a\u3089\u300c\u7121\u8996\u3055\u308c\u3066\u3044\u308b\u300d\u3068\u898b\u306a\u3059\u306e\u304c\u5b89\u5168\u3067\u3059\u3002")
    else:
        unk("`original` \u306f\u5224\u5b9a\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
        note("\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u00a73-1 \u306e\u300c\u65e2\u5b9a\u306f original\u300d\u3068\u3044\u3046\u8a18\u8ff0\u304c\u6b63\u3057\u3044\u304b\u3069\u3046\u304b\u306f\u3001"
             "\u3053\u306e\u5b9f\u884c\u3067\u306f\u78ba\u8a8d\u3067\u304d\u3066\u3044\u307e\u305b\u3093\u3002\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306f\u5909\u66f4\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002")
        _r = bad_res.get("original") or last_bad or {"status": None}
        add_undetermined("detail \u306b `original` \u3092\u6307\u5b9a\u3067\u304d\u308b\u304b\uff08\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u00a73-1 \u306e\u8a18\u8ff0\u306e\u771f\u507d\uff09",
                         undetermined_reason(_r), undetermined_howto(_r))

    d_none = rows.get("\u672a\u6307\u5b9a", {}).get("image_tokens")
    d_low = rows.get("low", {}).get("image_tokens")
    d_high = rows.get("high", {}).get("image_tokens")
    if d_none is not None and d_low is not None:
        if d_low < d_none:
            saved = d_none - d_low
            ok("detail=low \u306b\u3059\u308b\u3068\u753b\u50cf 1 \u679a\u3042\u305f\u308a %d \u30c8\u30fc\u30af\u30f3\u524a\u6e1b\u3067\u304d\u307e\u3059\u3002" % saved)
            note("terra \u306e\u5165\u529b\u5358\u4fa1 $2/1M \u3067\u63db\u7b97\u3059\u308b\u3068 1 \u679a\u3042\u305f\u308a %.4f \u5186\u306e\u5dee\u3067\u3059"
                 "\uff08\u6708 80 \u679a\u306a\u3089 %.1f \u5186\uff09\u3002\u6570\u5f0f\u30fb\u624b\u66f8\u304d\u3092\u8aad\u3080\u7528\u9014\u306a\u306e\u3067\u3001"
                 "\u30b3\u30b9\u30c8\u5dee\u304c\u5c0f\u3055\u3051\u308c\u3070\u7cbe\u5ea6\u512a\u5148\u3067\u554f\u984c\u3042\u308a\u307e\u305b\u3093\u3002"
                 % (saved * 2.0 / 1e6 * USD_JPY, saved * 2.0 / 1e6 * USD_JPY * 80))
        elif d_low == d_none:
            warn("detail=low \u3068\u672a\u6307\u5b9a\u3067\u30c8\u30fc\u30af\u30f3\u6570\u304c\u540c\u3058\u3067\u3059\uff08\u3068\u3082\u306b %d\uff09\u3002" % d_low)
            note("512x512 \u306f\u3082\u3068\u3082\u3068 low \u306e\u4e0a\u9650\u3068\u540c\u3058\u306a\u306e\u3067\u5dee\u304c\u51fa\u306a\u3044\u3060\u3051\u306e\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002"
                 "\u2466 \u306e\u5927\u304d\u3044\u30b5\u30a4\u30ba\u306e\u7d50\u679c\u3092\u898b\u3066\u5224\u65ad\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
    if d_none is not None and d_high is not None and d_high == d_none:
        info("\u672a\u6307\u5b9a\u3068 detail=high \u306f\u540c\u3058\u30c8\u30fc\u30af\u30f3\u6570\u3067\u3059\u3002\u2192 \u65e2\u5b9a\u306f high \u76f8\u5f53\u3068\u307f\u3089\u308c\u307e\u3059\u3002")

    out = {"status": "ok" if accepted else "fail", "variants": rows,
           "accepted": accepted, "rejected": rejected, "undetermined": undet}
    RESULT["checks"]["detail"] = out
    return out


def check_image_sizes(cfg: dict, model: str, baseline: int, known: dict) -> dict:
    hr("\u2466 \u753b\u50cf\u30b5\u30a4\u30ba\u3068\u30c8\u30fc\u30af\u30f3\u6570\u306e\u95a2\u4fc2")
    sizes = [64, 512, 1024, 2048]
    rows = {}
    last_bad = None
    if baseline is None:
        warn("\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\uff08\u753b\u50cf\u306a\u3057\u306e prompt_tokens\uff09\u304c\u53d6\u308c\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u753b\u50cf\u5206\u306e\u5dee\u5206\u306f\u51fa\u305b\u307e\u305b\u3093\u3002")
        info("\u2463 Vision \u304c\u6e2c\u308c\u3066\u3044\u306a\u3044\u5834\u5408\u3001\u3053\u306e\u30c1\u30a7\u30c3\u30af\u306e\u7d50\u8ad6\u306f\u51fa\u305b\u307e\u305b\u3093\u3002")
    for s in sizes:
        if s in known:
            rows[str(s)] = {"verdict": V_SUPPORTED, "image_tokens": known[s], "reused": True}
            ok("%4dx%-4d \u2192 \u753b\u50cf\u5206 %s \u30c8\u30fc\u30af\u30f3\uff08\u4e0a\u306e\u30c1\u30a7\u30c3\u30af\u306e\u7d50\u679c\u3092\u518d\u5229\u7528\uff09"
               % (s, s, known[s]))
            continue
        png = make_png(s)
        m = measure_prompt_tokens(cfg, model, [text_part(MEASURE_TEXT), image_part(data_url(png, "image/png"))], str(s))
        if not m["ok"]:
            verdict = classify_result(m["res"], keywords=("image",))
            rows[str(s)] = {"verdict": verdict, "error": m["error"], "http": m["http"]}
            last_bad = m["res"]
            if verdict == V_UNDETERMINED:
                unk("%4dx%-4d \u2192 HTTP %s : %s\uff08\u5224\u5b9a\u4e0d\u80fd\uff09"
                    % (s, s, m["http"], (m["error"] or "")[:80]))
            else:
                ng("%4dx%-4d \u2192 \u62d2\u5426 / HTTP %s : %s" % (s, s, m["http"], (m["error"] or "")[:80]))
            continue
        delta = (m["prompt_tokens"] - baseline) if baseline is not None else None
        rows[str(s)] = {"verdict": V_SUPPORTED, "image_tokens": delta,
                        "prompt_tokens": m["prompt_tokens"], "png_bytes": len(png)}
        ok("%4dx%-4d \u2192 \u753b\u50cf\u5206 %s \u30c8\u30fc\u30af\u30f3\uff08PNG %d \u30d0\u30a4\u30c8\uff09"
           % (s, s, delta if delta is not None else "\u4e0d\u660e", len(png)))

    vals = {int(k): v["image_tokens"] for k, v in rows.items()
            if v.get("image_tokens") is not None}
    print("")
    if not vals:
        # 1 \u30b5\u30a4\u30ba\u3082\u6e2c\u308c\u3066\u3044\u306a\u3044\u3002\u3053\u3053\u3067\u300c\u30c8\u30fc\u30af\u30f3\u6570\u306f\u5897\u3048\u306a\u3044\uff0f\u5897\u3048\u308b\u300d\u3092\u66f8\u304f\u3068\u5618\u306b\u306a\u308b\u3002
        if any(v.get("verdict") == V_REJECTED for v in rows.values()):
            out = {"status": "fail", "by_size": rows}
            ng("\u753b\u50cf\u30b5\u30a4\u30ba\u3068\u30c8\u30fc\u30af\u30f3\u6570\u306e\u95a2\u4fc2\u3092\u6e2c\u308c\u307e\u305b\u3093\u3067\u3057\u305f\uff08\u753b\u50cf\u305d\u306e\u3082\u306e\u304c\u62d2\u5426\u3055\u308c\u3066\u3044\u307e\u3059\uff09\u3002")
        else:
            out = {"status": V_UNDETERMINED, "by_size": rows}
            reason = (undetermined_reason(last_bad) if last_bad
                      else "\u2463 Vision \u306e\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\u304c\u53d6\u308c\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u753b\u50cf\u5206\u306e\u5dee\u5206\u3092\u8a08\u7b97\u3067\u304d\u307e\u305b\u3093")
            howto = (undetermined_howto(last_bad) if last_bad
                     else "\u2463 Vision \u304c\u6e2c\u308c\u308b\u72b6\u614b\u306b\u3057\u3066\u304b\u3089\u518d\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
            unk("\u753b\u50cf\u30b5\u30a4\u30ba\u3068\u30c8\u30fc\u30af\u30f3\u6570\u306e\u95a2\u4fc2\u306f **\u5224\u5b9a\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f**\u3002")
            info("\u6e2c\u308c\u306a\u304b\u3063\u305f\u7406\u7531: %s" % reason)
            info("\u6e2c\u308b\u306b\u306f: %s" % howto)
            add_undetermined("\u753b\u50cf\u30b5\u30a4\u30ba\u3068\u30c8\u30fc\u30af\u30f3\u6570\u306e\u95a2\u4fc2\uff08\u30b3\u30b9\u30c8\u8a66\u7b97\u306e\u5b9f\u6e2c\u5024\uff09", reason, howto)
            note("\u300c\u30b5\u30a4\u30ba\u3092\u5909\u3048\u3066\u3082\u30c8\u30fc\u30af\u30f3\u6570\u306f\u5909\u308f\u3089\u306a\u3044\u300d\u3068\u3044\u3063\u305f\u7d50\u8ad6\u306f\u3053\u3053\u3067\u306f\u51fa\u305b\u307e\u305b\u3093\u3002")
        RESULT["checks"]["image_size"] = out
        return out
    out = {"status": "ok", "by_size": rows}
    if len(vals) >= 2:
        lo, hi = min(vals.values()), max(vals.values())
        out["min"], out["max"] = lo, hi
        if hi - lo <= max(1, int(hi * 0.10)):
            ok("\u30b5\u30a4\u30ba\u3092\u5909\u3048\u3066\u3082\u30c8\u30fc\u30af\u30f3\u6570\u304c\u307b\u307c\u5909\u308f\u308a\u307e\u305b\u3093\uff08%d \u301c %d\uff09\u3002" % (lo, hi))
            note("\u30d7\u30ed\u30d0\u30a4\u30c0\u5074\u3067\u4e00\u5b9a\u30b5\u30a4\u30ba\u306b\u30ea\u30b5\u30a4\u30ba\u3055\u308c\u3066\u3044\u308b\u3068\u307f\u3089\u308c\u307e\u3059\u3002"
                 "\u3053\u306e\u5834\u5408\u3001**\u9001\u4fe1\u524d\u306e\u89e3\u50cf\u5ea6\u4e0a\u9650\u3092\u5165\u308c\u3066\u3082\u30b3\u30b9\u30c8\u306f\u4e0b\u304c\u308a\u307e\u305b\u3093**"
                 "\uff08\u8ee2\u9001\u91cf\u3068\u30ec\u30a4\u30c6\u30f3\u30b7\u306e\u6539\u5584\u306b\u306f\u306a\u308a\u307e\u3059\uff09\u3002")
            out["conclusion"] = "flat"
        else:
            warn("\u30b5\u30a4\u30ba\u306b\u5fdc\u3058\u3066\u30c8\u30fc\u30af\u30f3\u6570\u304c\u5897\u3048\u307e\u3059\uff08%d \u301c %d\uff09\u3002" % (lo, hi))
            note("\u89e3\u50cf\u5ea6\u304c\u305d\u306e\u307e\u307e\u8ab2\u91d1\u306b\u8df3\u306d\u307e\u3059\u3002\u672c\u756a\u3067\u306f\u9001\u4fe1\u524d\u306e\u30ea\u30b5\u30a4\u30ba\u3092\u3057\u3066\u3044\u306a\u3044\u306e\u3067"
                 "\uff08processAttachments \u306f EXIF \u9664\u53bb\u306e\u307f\uff09\u3001**\u9577\u8fba 1,024 \u306a\u3069\u306e\u4e0a\u9650\u3092\u5165\u308c\u308b\u4fa1\u5024\u304c\u3042\u308a\u307e\u3059**\u3002")
            out["conclusion"] = "grows"
            # 「これ以上大きくしてもトークンが増えない」点が内部リサイズの上限の手がかり。
            # 小さい側で値が並ぶのは単に閾値未満なだけなので、頭打ちの開始点だけを見る。
            ordered = sorted(vals.items())
            plateau = min(sz for sz, tk in ordered if tk == hi)
            larger = [sz for sz, _ in ordered if sz > plateau]
            if larger:
                info("%d px \u4ee5\u4e0a\u3067\u306f\u30c8\u30fc\u30af\u30f3\u6570\u304c\u5897\u3048\u307e\u305b\u3093"
                     "\uff08%d px \u3082 %d px \u3082 %d \u30c8\u30fc\u30af\u30f3\uff09\u3002"
                     % (plateau, plateau, max(larger), hi))
                note("%d px \u4ed8\u8fd1\u3067\u5185\u90e8\u30ea\u30b5\u30a4\u30ba\u306e\u4e0a\u9650\u306b\u9054\u3057\u3066\u3044\u308b\u3068\u307f\u3089\u308c\u307e\u3059\u3002"
                     "\u9001\u4fe1\u524d\u306b\u9577\u8fba %d px \u307e\u3067\u843d\u3068\u3057\u3066\u3082\u30c8\u30fc\u30af\u30f3\u6570\uff08=\u30b3\u30b9\u30c8\uff09\u306f\u5909\u308f\u3089\u305a\u3001"
                     "\u8ee2\u9001\u91cf\u3068\u30ec\u30a4\u30c6\u30f3\u30b7\u3060\u3051\u304c\u6539\u5584\u3057\u307e\u3059\u3002" % (plateau, plateau))
                out["resize_threshold_hint"] = plateau
            else:
                info("\u6e2c\u3063\u305f\u7bc4\u56f2\uff08\u6700\u5927 %d px\uff09\u3067\u306f\u307e\u3060\u982d\u6253\u3061\u306b\u306a\u3063\u3066\u3044\u307e\u305b\u3093\u3002" % ordered[-1][0])
                note("\u3053\u306e\u5148\u3082\u5897\u3048\u7d9a\u3051\u308b\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002\u30b9\u30de\u30db\u5199\u771f\u306f\u3055\u3089\u306b\u5927\u304d\u3044\u306e\u3067\u6ce8\u610f\u304c\u5fc5\u8981\u3067\u3059\u3002")
            if 2048 in vals and 1024 in vals and vals[2048] > vals[1024]:
                # 面積比から 12MP（約 3000x4000）を外挿する
                per_px = (vals[2048] - vals[1024]) / float(2048 * 2048 - 1024 * 1024)
                est = vals[2048] + per_px * (3024 * 4032 - 2048 * 2048)
                out["estimated_phone_photo_tokens"] = int(est)
                info("\u3053\u306e\u4f38\u3073\u65b9\u304b\u3089\u30b9\u30de\u30db\u5199\u771f\uff083024x4032 \u2248 12MP\uff09\u3092\u5916\u633f\u3059\u308b\u3068 \u7d04 %d \u30c8\u30fc\u30af\u30f3/\u679a\u3067\u3059\u3002" % est)
                note("\u3053\u306e\u5024\u304c\u5927\u304d\u3044\u306a\u3089\u3001\u9001\u4fe1\u524d\u30ea\u30b5\u30a4\u30ba\u304b ``detail: \"low\"`` \u306e\u5c0e\u5165\u3092\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
    RESULT["checks"]["image_size"] = out
    return out


def check_webp(cfg: dict, model: str, baseline: int, png512_tokens) -> dict:
    hr("\u2467 WebP \u304c\u53d7\u3051\u4ed8\u3051\u3089\u308c\u308b\u304b")
    try:
        webp = make_webp(512)
    except Exception as e:
        warn("\u672a\u691c\u8a3c\uff1aWebP \u3092\u751f\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\uff08%s\uff09\u3002" % e)
        out = {"status": "unknown", "reason": "generation_failed"}
        RESULT["checks"]["webp"] = out
        return out

    info("\u751f\u6210\u3057\u305f WebP: 512x512 / %d \u30d0\u30a4\u30c8\uff08\u53ef\u9006 VP8L\u30fb\u5358\u8272\u8d64\uff09" % len(webp))
    info("\u203b \u5916\u90e8\u30e9\u30a4\u30d6\u30e9\u30ea\u306a\u3057\u3067\u7d44\u307f\u7acb\u3066\u3066\u3044\u307e\u3059\u3002libwebp / ImageMagick / macOS ImageIO / Pillow \u306e")
    info("   4 \u3064\u306e\u30c7\u30b3\u30fc\u30c0\u3067\u300c512x512 lossless\u30fb\u5168\u753b\u7d20 RGB(255,0,0)\u300d\u3068\u8aad\u3081\u308b\u3053\u3068\u3092\u78ba\u8a8d\u6e08\u307f\u3067\u3059\u3002")
    print("")

    r = chat(model, [text_part(MEASURE_TEXT), image_part(data_url(webp, "image/webp"))],
             TUTOR_MAX_TOKENS, cfg["key"], cfg["base"])
    res = r["res"]
    out = {"status": "fail", "bytes": len(webp), "http": res["status"]}
    if res["status"] != 200:
        # WebP \u3092\u7406\u7531\u306b\u62d2\u5426\u3055\u308c\u305f\u306e\u304b\u3001\u5358\u306b\u8a55\u4fa1\u3055\u308c\u306a\u304b\u3063\u305f\u306e\u304b\u3092\u533a\u5225\u3059\u308b\u3002
        # \u3053\u3053\u3092\u53d6\u308a\u9055\u3048\u308b\u3068\u300c\u7406\u7531\u306a\u304f WebP \u5bfe\u5fdc\u3092\u524a\u308b\u300d\u3068\u3044\u3046\u5b9f\u5bb3\u306e\u3042\u308b\u6307\u793a\u304c\u51fa\u308b\u3002
        verdict = classify_result(
            res, keywords=("webp", "mime", "unsupported image", "image type",
                           "image format", "invalid image"))
        out["verdict"] = verdict
        out["error"] = api_error(res)
        if verdict == V_UNDETERMINED:
            unk("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
            report_undetermined("WebP \u753b\u50cf\u304c\u53d7\u3051\u4ed8\u3051\u3089\u308c\u308b\u304b", res)
            note("**WebP \u304c\u62d2\u5426\u3055\u308c\u305f\u3068\u3044\u3046\u7d50\u8ad6\u306f\u51fa\u305b\u307e\u305b\u3093\u3002** "
                 "SUPPORTED_IMAGE_MIMETYPES\uff08src/shared/lib/constants.ts\uff09\u306f"
                 "\u3053\u306e\u5b9f\u884c\u3092\u6839\u62e0\u306b\u5909\u66f4\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002")
            out["status"] = V_UNDETERMINED
            RESULT["checks"]["webp"] = out
            return out
        ng("HTTP %s\uff1a%s" % (res["status"], api_error(res)))
        note("WebP \u306f\u53d7\u3051\u4ed8\u3051\u3089\u308c\u307e\u305b\u3093\u3002SUPPORTED_IMAGE_MIMETYPES \u306b image/webp \u304c\u5165\u3063\u3066\u3044\u308b\u306e\u3067"
             "\uff08src/shared/lib/constants.ts:117\uff09\u3001Slack \u306b WebP \u3092\u8cbc\u3089\u308c\u308b\u3068\u305d\u306e\u8cea\u554f\u3060\u3051\u5931\u6557\u3057\u307e\u3059\u3002")
        add_code_change(
            "src/shared/lib/constants.ts \u306e SUPPORTED_IMAGE_MIMETYPES \u304b\u3089 'image/webp' \u3092\u5916\u3059\u304b\u3001"
            "PNG/JPEG \u306b\u5909\u63db\u3057\u3066\u304b\u3089\u9001\u308b\uff08\u5b9f\u6e2c\u3067 WebP \u304c\u62d2\u5426\u3055\u308c\u305f\uff09")
        RESULT["checks"]["webp"] = out
        return out

    body = content_of(res)
    u = usage_of(res)
    pt = int(u.get("prompt_tokens") or 0)
    delta = (pt - baseline) if baseline is not None else None
    out.update({"answer": body.strip()[:200], "prompt_tokens": pt, "image_tokens": delta})
    info("\u5fdc\u7b54: %s" % (body.strip()[:100] or "\uff08\u7a7a\uff09"))
    info("\u753b\u50cf\u5206\u30c8\u30fc\u30af\u30f3: %s" % (delta if delta is not None else "\u4e0d\u660e"))

    if "\u8d64" in body:
        ok("WebP \u3092\u9001\u3063\u3066\u300c\u8d64\u300d\u3068\u7b54\u3048\u307e\u3057\u305f\u3002WebP \u306f\u5b8c\u5168\u306b\u4f7f\u3048\u307e\u3059\u3002")
        note("Slack \u3067 WebP \u304c\u8cbc\u3089\u308c\u3066\u3082\u305d\u306e\u307e\u307e\u51e6\u7406\u3067\u304d\u307e\u3059\u3002\u30b3\u30fc\u30c9\u5909\u66f4\u306f\u4e0d\u8981\u3067\u3059\u3002")
        out["status"] = "ok"
    elif body.strip():
        warn("\u5fdc\u7b54\u306f\u8fd4\u3063\u305f\u304c\u300c\u8d64\u300d\u304c\u542b\u307e\u308c\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
        note("\u30a8\u30e9\u30fc\u306b\u306f\u306a\u3063\u3066\u3044\u306a\u3044\u306e\u3067\u5f62\u5f0f\u81ea\u4f53\u306f\u53d7\u4ed8\u3055\u308c\u3066\u3044\u307e\u3059\u3002\u4e0a\u306e\u5fdc\u7b54\u3092\u76ee\u3067\u898b\u3066\u5224\u65ad\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
        out["status"] = "warn"
    else:
        warn("\u672c\u6587\u304c\u7a7a\u3067\u3057\u305f\uff08finish_reason=%s\uff09\u3002\u5f62\u5f0f\u306e\u53ef\u5426\u306f\u5224\u5b9a\u3067\u304d\u307e\u305b\u3093\u3002" % finish_of(res))
        out["status"] = "unknown"

    if delta is not None and png512_tokens is not None:
        if delta == png512_tokens:
            info("\u540c\u3058 512x512 \u306e PNG \u3068\u30c8\u30fc\u30af\u30f3\u6570\u304c\u4e00\u81f4\u3057\u307e\u3059\uff08\u3068\u3082\u306b %d\uff09\u3002" % delta)
            note("\u30c8\u30fc\u30af\u30f3\u6570\u306f\u5f62\u5f0f\u3067\u306f\u306a\u304f\u5bf8\u6cd5\u3067\u6c7a\u307e\u308b\u3001\u3068\u3044\u3046\u88cf\u4ed8\u3051\u3067\u3059\u3002")
        else:
            info("512x512 PNG \u306f %s\u3001WebP \u306f %s \u3067\u3057\u305f\u3002" % (png512_tokens, delta))

    RESULT["checks"]["webp"] = out
    return out


# ------------------------------------------------------------------------------
# まとめ
# ------------------------------------------------------------------------------

def cost_of_run() -> tuple:
    total = 0.0
    known = True
    for model, u in USAGE_BY_MODEL.items():
        name = model[model.rfind("/") + 1:]
        price = PRICING.get(name)
        if price is None:
            known = False
            continue
        total += u["prompt"] / 1e6 * price[0] + u["completion"] / 1e6 * price[1]
    return total, known


def print_cost_update(res_sizes: dict, tokens: dict) -> None:
    """画像 1 枚の実トークン数が 1 つ以上測れているときだけ呼ばれる."""
    print("      \u753b\u50cf 1 \u679a\u3042\u305f\u308a\u306e\u5b9f\u30c8\u30fc\u30af\u30f3\u6570\uff08\u6e2c\u5b9a\u5024\uff09:")
    for s in sorted(tokens):
        print("        %5d x %-5d : %6d \u30c8\u30fc\u30af\u30f3" % (s, s, tokens[s]))
    if len(tokens) == 1:
        print("      \u26a0\ufe0f  1 \u30b5\u30a4\u30ba\u3057\u304b\u6e2c\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u5b9f\u969b\u306e\u30b9\u30de\u30db\u5199\u771f\u306f\u3053\u308c\u3088\u308a\u306f\u308b\u304b\u306b\u5927\u304d\u3044\u306e\u3067\u3001")
        print("         \u3053\u306e\u5024\u3092\u305d\u306e\u307e\u307e\u8a66\u7b97\u306b\u4f7f\u308f\u306a\u3044\u3067\u304f\u3060\u3055\u3044\uff08--quick \u306a\u3057\u3067\u518d\u5b9f\u884c\u3059\u308b\u3068 4 \u30b5\u30a4\u30ba\u6e2c\u308a\u307e\u3059\uff09\u3002")
    # 代表値: 本番は送信前リサイズをしていないので、大きい側を採る
    rep = max(tokens.values())
    est_phone = (res_sizes or {}).get("estimated_phone_photo_tokens")
    print("")
    print("      \u2192 \u6c7a\u5b9a\u4e8b\u9805 \u00a74-1 \u306e terra \u5165\u529b\u300c5,500 = 4,000 + \u4eee\u5024 1,500\u300d\u3092")
    print("         \u300c%s = 4,000 + %s\u300d\u306b\u5dee\u3057\u66ff\u3048\u3066\u304f\u3060\u3055\u3044\u3002" % ("{:,}".format(4000 + rep), "{:,}".format(rep)))
    if est_phone:
        print("         \uff08\u30b9\u30de\u30db\u5199\u771f\u76f8\u5f53\u306e\u5916\u633f\u5024\u3092\u63a1\u308b\u306a\u3089 %s \u30c8\u30fc\u30af\u30f3\uff09" % "{:,}".format(est_phone))

    # 月額の再計算（決定事項 §4-2 の画像率 20% シナリオ）
    luna_part = 0.478           # §4-2 の luna 分（画像トークンの影響を受けない）
    terra_in = 80 * (4000 + rep) / 1e6 * 2.0
    terra_out = 80 * 500 / 1e6 * 12.0
    monthly = luna_part + terra_in + terra_out
    print("")
    print("      \u6708\u984d\u306e\u518d\u8a08\u7b97\uff08\u751f\u5f92 20 \u540d / \u6708 400 \u554f / \u753b\u50cf\u7387 20%\uff09:")
    print("        \u65e7\uff08\u4eee\u5024 1,500\uff09 : $1.84 / \u6708")
    print("        \u65b0\uff08\u5b9f\u6e2c %s\uff09 : $%.2f / \u6708  \uff08\u2248 %.0f \u5186\uff09"
          % ("{:,}".format(rep), monthly, monthly * USD_JPY))
    print("      \u2192 LLM \u4ee3\u306e\u3046\u3061 terra \u306e\u5165\u529b\u5206\u304c $%.2f\u3002\u30a4\u30f3\u30d5\u30e9\u56fa\u5b9a\u8cbb\uff08Vercel Pro $20\uff09\u306e\u65b9\u304c\u5727\u5012\u7684\u306b\u5927\u304d\u3044\u307e\u307e\u304b\u3092\u898b\u3066\u304f\u3060\u3055\u3044\u3002" % terra_in)

    # ロードマップ 0-2 の判断表
    print("")
    if rep <= 2000:
        ok("\u753b\u50cf 1 \u679a %s \u30c8\u30fc\u30af\u30f3 \u2264 2,000 \u2192 \u8a66\u7b97\u3069\u304a\u308a\u3002\u305d\u306e\u307e\u307e\u9032\u3081\u3066\u554f\u984c\u3042\u308a\u307e\u305b\u3093\uff08\u4e0a\u9650 $20 \u3092\u7dad\u6301\uff09\u3002" % "{:,}".format(rep))
    elif rep <= 10000:
        warn("\u753b\u50cf 1 \u679a %s \u30c8\u30fc\u30af\u30f3\uff082,000\u301c10,000\uff09\u2192 \u6c7a\u5b9a\u4e8b\u9805 \u00a74-2 \u306e\u8868\u3092\u4e0a\u306e\u6570\u5b57\u3067\u5f15\u304d\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002" % "{:,}".format(rep))
        info("\u4e0a\u9650 $20 \u3067\u8db3\u308a\u308b\u304b\uff08\u4e0a\u306e\u6708\u984d\u306e 10 \u500d\u4ee5\u4e0a\u304b\uff09\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
    else:
        ng("\u753b\u50cf 1 \u679a %s \u30c8\u30fc\u30af\u30f3 > 10,000 \u2192 detail=\"low\" \u304b\u9001\u4fe1\u524d\u30ea\u30b5\u30a4\u30ba\u3092\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002" % "{:,}".format(rep))
        info("\u652f\u51fa\u4e0a\u9650\u3082\u518d\u8a08\u7b97\u304c\u5fc5\u8981\u3067\u3059\uff08\u30ed\u30fc\u30c9\u30de\u30c3\u30d7 \u30d5\u30a7\u30fc\u30ba 0-2\uff09\u3002")

    RESULT["summary"]["cost_update"] = {
        "measured": True,
        "image_tokens_by_size": tokens,
        "representative_image_tokens": rep,
        "estimated_phone_photo_tokens": est_phone,
        "terra_input_tokens_per_question": 4000 + rep,
        "monthly_usd_20pct_images": round(monthly, 4),
    }


def print_summary(cfg: dict, res_chat: dict, res_vision: dict, res_emb: dict,
                  res_sizes: dict, res_detail: dict,
                  res_auth: dict = None, res_models: dict = None) -> None:
    hr("まとめ")
    res_auth = res_auth or {}
    res_models = res_models or {}

    # ---------- 0. 測定できていないことの最優先の告知 ----------
    if _QUOTA_STATE["quota"]:
        print("")
        print("  " + "!" * 66)
        print("  !!  クレジット残高がゼロのため、③以降は測定できていません。")
        print("  !!  https://platform.openai.com/settings/organization/billing で")
        print("  !!  クレジットを追加してから、このスクリプトを再実行してください。")
        print("  !!")
        print("  !!  以下に出る「—（判定不能）」は、その機能が使えないという意味ではありません。")
        print("  !!  試せなかっただけです。これを根拠にコードやドキュメントを直さないでください。")
        print("  " + "!" * 66)
    elif _QUOTA_STATE["rate"]:
        print("")
        print("  " + "!" * 66)
        print("  !!  レート制限（429）に当たったため、一部のチェックは測定できていません。")
        print("  !!  しばらく待ってから再実行してください。")
        print("  " + "!" * 66)

    # ---------- 0-b. この実行で確定した事実 ----------
    listed = (res_models.get("listed") or {})
    model_pairs = (("default", cfg["model_default"]),
                   ("complex", cfg["model_complex"]),
                   ("embedding", cfg["embedding_model"]))
    print("")
    print("  【０】この実行で確定した事実")
    print("  " + "-" * 66)
    facts = []      # (記号, 本文)
    if res_auth.get("status") == "ok":
        facts.append(("✅", "API キーは有効で、LLM_BASE_URL（%s）も正しい。モデル一覧を %s 件取得できた。"
                            % (cfg["base"], res_auth.get("model_count"))))
    present = [m for k, m in model_pairs if listed.get(k)]
    missing = [m for k, m in model_pairs if listed and not listed.get(k)]
    if present:
        facts.append(("✅", "次のモデル ID は **実在します**（/models の一覧に載っている）: %s"
                            % " / ".join(present)))
        facts.append(("", "→ 「モデル ID が存在しないのでは」というブロッカーは解消済みです。"
                          "実際の生成が通るかは ③ 以降の結果を見てください。"))
    if missing:
        facts.append(("❌", "次のモデル ID は /models の一覧に **ありません**: %s" % " / ".join(missing)))
        facts.append(("", "→ ② の「似た ID の候補」から選び直してください。"))
    if facts:
        for mark, text in facts:
            print("      %s %s" % (mark, text) if mark else "        %s" % text)
    else:
        print("      （確定できた事実はありません。① 認証の結果を見てください。）")
    RESULT["summary"]["confirmed_facts"] = [{"mark": m, "text": t} for m, t in facts]

    # ---------- 1. 環境変数 ----------
    print("")
    print("  【１】本番の環境変数に設定すべき値（そのまま貼れます）")
    print("  " + "-" * 66)

    def model_mark(chk) -> str:
        """✅ 実呼び出しで確認 / — 未検証（測定できていない） / ❌ 使えないことを確認."""
        st = (chk or {}).get("status")
        if st in ("ok", "warn"):
            return "✅"
        if st in (V_UNDETERMINED, None, "skip"):
            return "—"
        return "❌"

    marks_by_key = {"default": model_mark(res_chat.get("default")),
                    "complex": model_mark(res_chat.get("complex")),
                    "embedding": model_mark(res_emb)}
    d_ok = marks_by_key["default"] == "✅"
    c_ok = marks_by_key["complex"] == "✅"
    e_ok = marks_by_key["embedding"] == "✅"
    lines = [
        "LLM_BASE_URL=%s" % cfg["base"],
        "LLM_MODEL_DEFAULT=%s" % cfg["model_default"],
        "LLM_MODEL_COMPLEX=%s" % cfg["model_complex"],
        "EMBEDDING_BASE_URL=%s" % cfg["embedding_base"],
        "EMBEDDING_MODEL=%s" % cfg["embedding_model"],
    ]
    keys = [None, "default", "complex", None, "embedding"]
    marks = ["✅" if k is None else marks_by_key[k] for k in keys]
    for mark, line, key in zip(marks, lines, keys):
        suffix = ""
        if mark == "—" and key:
            suffix = ("   ← 一覧に存在することは確認済み。ただし実際の生成は未検証"
                      if listed.get(key) else "   ← 未検証（測定できていません）")
        print("      %s %s%s" % (mark, line, suffix))
    print("      ℹ  LLM_API_KEY / EMBEDDING_API_KEY は同じキーを使えます（ここには出しません）")
    print("      ℹ  ✅ = 実際に呼び出して成功 ／ — = 未検証（測定できていない） ／ ❌ = 使えないことを確認")
    if "❌" in marks:
        print("      ⚠️  ❌ が付いた行はそのまま使えません。② のモデル一覧から正しい ID を探してください。")
    if "—" in marks:
        print("      ⚠️  — が付いた行は「使えない」ではなく「試せていない」です。値はこのままで構いません。")
    RESULT["summary"]["env"] = {"lines": lines, "marks": marks,
                               "all_ok": bool(d_ok and c_ok and e_ok)}

    # ---------- 2. コード修正 ----------
    print("")
    print("  \u3010\uff12\u3011\u30b3\u30fc\u30c9\u4fee\u6b63\u304c\u5fc5\u8981\u306b\u306a\u3063\u305f\u9805\u76ee")
    print("  " + "-" * 66)
    print("      ※ 実測で確定した項目だけを載せています（判定不能だったものは【２-b】）。")
    if _CODE_CHANGES:
        for i, c in enumerate(_CODE_CHANGES, 1):
            print("      %d. %s" % (i, c["item"]))
            for d in c["details"]:
                print("         - %s" % d)
    else:
        print("      \u2705 \u3042\u308a\u307e\u305b\u3093\u3002\u73fe\u884c\u30b3\u30fc\u30c9\u306e\u307e\u307e\u672c\u756a\u306b\u51fa\u305b\u307e\u3059\u3002")
    print("")
    print("      \uff08\u4e0a\u8a18\u3068\u306f\u5225\u306b\u3001\u30e2\u30c7\u30eb ID \u304c\u78ba\u5b9a\u3057\u305f\u306e\u3067\u5fc5\u305a\u884c\u3046\u3082\u306e\uff09")
    print("      \u2022 src/shared/lib/constants.ts \u306e MODEL_PRICING \u306b '%s' \u3068 '%s' \u3092\u8ffd\u8a18\u3059\u308b\u3002"
          % (cfg["model_default"], cfg["model_complex"]))
    print("        \u672a\u767b\u9332\u306e\u307e\u307e\u3060\u3068 /admin/usage \u306e\u30b3\u30b9\u30c8\u304c $0.00 \u306e\u307e\u307e\u7a4d\u307f\u4e0a\u304c\u308a\u3001\u66b4\u8d70\u306b\u6c17\u3065\u3051\u307e\u305b\u3093\u3002")
    if _DOC_CHANGES:
        print("")
        print("      \uff08\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306e\u4fee\u6b63\uff09")
        for c in _DOC_CHANGES:
            print("      \u2022 %s" % c)
    RESULT["summary"]["code_changes"] = _CODE_CHANGES
    RESULT["summary"]["doc_changes"] = _DOC_CHANGES

    # ---------- 2-b. 測定できなかったため保留 ----------
    if _UNDETERMINED:
        print("")
        print("  【２-b】測定できなかったため保留（結論は出していません）")
        print("  " + "-" * 66)
        print("      ここに並ぶ項目は「使えない」ではなく「試せていない」です。")
        print("      この一覧を根拠にコードやドキュメントを変更しないでください。")
        print("")
        for i, u in enumerate(_UNDETERMINED, 1):
            print("      %d. %s" % (i, u["item"]))
            print("         測れなかった理由: %s" % u["reason"])
            if u.get("howto"):
                print("         測るには      : %s" % u["howto"])
    RESULT["summary"]["undetermined"] = _UNDETERMINED

    # ---------- 3. 試算の更新 ----------
    print("")
    print("  \u3010\uff13\u3011\u8a66\u7b97\u3092\u66f4\u65b0\u3059\u3079\u304d\u6570\u5024")
    print("  " + "-" * 66)
    sizes = (res_sizes or {}).get("by_size") or {}
    tokens = {int(k): v["image_tokens"] for k, v in sizes.items() if v.get("image_tokens") is not None}
    if not tokens and res_vision.get("image_tokens") is not None:
        tokens = {64: res_vision["image_tokens"]}

    if not tokens:
        unk("画像 1 枚あたりのトークン数は **測定できませんでした**。")
        info("④ Vision と ⑦ 画像サイズがどちらも測れていないため、試算に入れる数字がありません。")
        info("試算（決定事項 §4-1 の仮値 1,500）は、実測できるまでそのまま据え置いてください。")
        note("「画像分のトークンは小さい／大きい」といった結論はここでは出せません。")
        RESULT["summary"]["cost_update"] = {"measured": False}
    else:
        print_cost_update(res_sizes, tokens)

    # ---------- 実行コスト ----------
    total, known = cost_of_run()
    print("")
    print("  \u3010\u53c2\u8003\u3011\u3053\u306e\u691c\u8a3c\u81ea\u4f53\u306b\u304b\u304b\u3063\u305f\u6982\u7b97\u30b3\u30b9\u30c8: $%.4f\uff08\u2248 %.1f \u5186\uff09%s"
          % (total, total * USD_JPY, "" if known else "\uff0f\u4e00\u90e8\u306f\u5358\u4fa1\u672a\u767b\u9332\u306e\u305f\u3081\u9664\u5916"))
    for model, u in sorted(USAGE_BY_MODEL.items()):
        print("        %-28s prompt=%d / completion=%d" % (model, u["prompt"], u["completion"]))
    RESULT["summary"]["run_cost_usd"] = round(total, 6)
    RESULT["summary"]["usage_by_model"] = USAGE_BY_MODEL


# ------------------------------------------------------------------------------
# main
# ------------------------------------------------------------------------------

def build_config(args) -> dict:
    base = (os.environ.get("LLM_BASE_URL") or DEF_BASE_URL).rstrip("/")
    emb_base = (os.environ.get("EMBEDDING_BASE_URL") or base).rstrip("/")
    key = os.environ.get("LLM_API_KEY") or ""
    if not key:
        print("API \u30ad\u30fc\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\uff08\u753b\u9762\u306b\u306f\u8868\u793a\u3055\u308c\u305a\u3001\u30b7\u30a7\u30eb\u5c65\u6b74\u306b\u3082\u6b8b\u308a\u307e\u305b\u3093\uff09\u3002")
        try:
            key = getpass.getpass("LLM_API_KEY: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("")
            sys.exit(1)
    else:
        print("\u2139 \u74b0\u5883\u5909\u6570 LLM_API_KEY \u3092\u4f7f\u3044\u307e\u3059\u3002")
    if not key:
        print("\u274c API \u30ad\u30fc\u304c\u7a7a\u3067\u3059\u3002")
        sys.exit(1)
    return {
        "base": base,
        "key": key,
        "model_default": os.environ.get("LLM_MODEL_DEFAULT") or DEF_MODEL_DEFAULT,
        "model_complex": os.environ.get("LLM_MODEL_COMPLEX") or DEF_MODEL_COMPLEX,
        "embedding_base": emb_base,
        "embedding_model": os.environ.get("EMBEDDING_MODEL") or DEF_EMBEDDING_MODEL,
        "embedding_key": os.environ.get("EMBEDDING_API_KEY") or key,
    }


def guarded(name: str, fn, *a, **kw) -> dict:
    """1 つのチェックが落ちても全体を止めない."""
    try:
        return fn(*a, **kw) or {}
    except Exception as e:
        ng("\u30c1\u30a7\u30c3\u30af\u300c%s\u300d\u304c\u4f8b\u5916\u3067\u4e2d\u65ad\u3057\u307e\u3057\u305f: %s: %s" % (name, type(e).__name__, e))
        note("\u3053\u306e\u30c1\u30a7\u30c3\u30af\u3060\u3051\u30b9\u30ad\u30c3\u30d7\u3057\u3066\u5148\u306b\u9032\u307f\u307e\u3059\u3002")
        return {"status": "error", "exception": "%s: %s" % (type(e).__name__, e)}


def collect_statuses() -> list:
    """checks の中に入れ子（chat: {default:..., complex:...}）があるので平らにする."""
    out = []
    for v in RESULT["checks"].values():
        if not isinstance(v, dict):
            continue
        if "status" in v:
            out.append(v.get("status"))
            continue
        for sub in v.values():
            if isinstance(sub, dict) and "status" in sub:
                out.append(sub.get("status"))
    return out


def exit_code() -> int:
    """0 = 全部 OK / 1 = 実測で失敗あり / 2 = 測定できなかった項目あり.

    2 は「悪い結果が出た」ではなく「結果が出ていない」。再実行が必要という意味。
    """
    statuses = collect_statuses()
    if any(s in ("fail", "error") for s in statuses):
        return 1
    if _QUOTA_STATE["quota"] or _QUOTA_STATE["rate"] or _UNDETERMINED \
            or any(s == V_UNDETERMINED for s in statuses):
        return 2
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        prog="check-llm.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "OpenAI \u5b9f\u30ad\u30fc\u3067\u30e2\u30c7\u30eb\u3092\u5b9f\u6e2c\u3057\u3001\u672c\u756a\u6295\u5165\u306b\u5fc5\u8981\u306a\u4e8b\u5b9f\u3092 1 \u56de\u3067\u78ba\u5b9a\u3055\u305b\u307e\u3059\u3002\n"
            "\u5b9f\u884c\u3059\u308b\u3068 API \u30ad\u30fc\u306e\u5165\u529b\u3092\u6c42\u3081\u3089\u308c\u307e\u3059\uff08\u753b\u9762\u306b\u8868\u793a\u3055\u308c\u305a\u3001\u30b7\u30a7\u30eb\u5c65\u6b74\u306b\u3082\u6b8b\u308a\u307e\u305b\u3093\uff09\u3002"),
        epilog=(
            "\u4f8b:\n"
            "  python3 scripts/check-llm.py\n"
            "  python3 scripts/check-llm.py --json | tee /tmp/check-llm.log\n"
            "  LLM_MODEL_DEFAULT=gpt-4o-mini python3 scripts/check-llm.py --quick\n"
            "\n"
            "\u74b0\u5883\u5909\u6570\uff08\u3059\u3079\u3066\u4efb\u610f\uff09:\n"
            "  LLM_API_KEY / LLM_BASE_URL / LLM_MODEL_DEFAULT / LLM_MODEL_COMPLEX\n"
            "  EMBEDDING_BASE_URL / EMBEDDING_MODEL / EMBEDDING_API_KEY\n"))
    p.add_argument("--json", action="store_true",
                   help="\u4eba\u304c\u8aad\u3080\u51fa\u529b\u306e\u5f8c\u306b\u3001\u8cbc\u308a\u4ed8\u3051\u3084\u3059\u3044 JSON \u30b5\u30de\u30ea\u3092\u51fa\u529b\u3059\u308b")
    p.add_argument("--quick", action="store_true",
                   help="\u2465 detail / \u2466 \u753b\u50cf\u30b5\u30a4\u30ba / \u2467 WebP \u3092\u7701\u7565\u3057\u3066\u77ed\u6642\u9593\u3067\u7d42\u308f\u3089\u305b\u308b")
    args = p.parse_args()

    cfg = build_config(args)

    print("")
    print("OpenAI \u5b9f\u30ad\u30fc\u3067\u306e\u30e2\u30c7\u30eb\u691c\u8a3c")
    print("  base_url        : %s" % cfg["base"])
    print("  default model   : %s" % cfg["model_default"])
    print("  complex model   : %s\uff08\u753b\u50cf\u4ed8\u304d\u8cea\u554f\u306f\u3053\u3061\u3089\u304c\u4f7f\u308f\u308c\u307e\u3059\uff09" % cfg["model_complex"])
    print("  embedding       : %s @ %s" % (cfg["embedding_model"], cfg["embedding_base"]))
    print("  \u203b 1 \u3064\u5931\u6557\u3057\u3066\u3082\u6b8b\u308a\u306f\u7d9a\u884c\u3057\u307e\u3059\u3002\u6700\u5f8c\u306e\u300c\u307e\u3068\u3081\u300d\u3060\u3051\u898b\u308c\u3070\u5224\u65ad\u3067\u304d\u307e\u3059\u3002")

    RESULT["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    RESULT["base_url"] = cfg["base"]
    RESULT["models"] = {"default": cfg["model_default"], "complex": cfg["model_complex"],
                        "embedding": cfg["embedding_model"]}

    auth = guarded("\u2460 \u8a8d\u8a3c", check_auth, cfg)
    if auth.get("status") in ("fail", V_UNDETERMINED):
        if args.json:
            print("")
            print("----- JSON -----")
            print(json.dumps(RESULT, ensure_ascii=False, indent=2))
        return exit_code()

    models = guarded("\u2461 \u30e2\u30c7\u30eb\u5b9f\u5728\u78ba\u8a8d", check_models, cfg, auth.get("_ids"))

    res_chat = {}
    res_chat["default"] = guarded("\u2462 Chat(default)", check_chat, cfg, "LLM_MODEL_DEFAULT", cfg["model_default"])
    if cfg["model_complex"] != cfg["model_default"]:
        res_chat["complex"] = guarded("\u2462 Chat(complex)", check_chat, cfg, "LLM_MODEL_COMPLEX", cfg["model_complex"])
    else:
        res_chat["complex"] = res_chat["default"]

    # reasoning が実際に動いていたときだけ、切る方法を探す
    rts = [v.get("reasoning_tokens") for v in res_chat.values() if isinstance(v, dict)]
    if any(isinstance(x, int) and x > 0 for x in rts):
        guarded("\u2462-b reasoning OFF", check_reasoning_off, cfg, cfg["model_default"])

    vision = guarded("\u2463 Vision", check_vision, cfg, cfg["model_complex"])
    emb = guarded("\u2464 Embedding", check_embedding, cfg)

    baseline = None
    if vision.get("image_tokens") is not None and vision.get("prompt_tokens") is not None:
        baseline = vision["prompt_tokens"] - vision["image_tokens"]

    detail = {}
    sizes = {}
    if args.quick:
        hr("\u2465\u2466\u2467 \u306f --quick \u306e\u305f\u3081\u30b9\u30ad\u30c3\u30d7\u3057\u307e\u3057\u305f")
        info("detail \u306e\u6319\u52d5\u30fb\u753b\u50cf\u30b5\u30a4\u30ba\u3068\u30c8\u30fc\u30af\u30f3\u306e\u95a2\u4fc2\u30fbWebP \u306e\u53ef\u5426\u306f\u672a\u78ba\u5b9a\u306e\u307e\u307e\u3067\u3059\u3002")
        info("\u672c\u756a\u6295\u5165\u524d\u306b\u306f --quick \u306a\u3057\u3067 1 \u56de\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002")
    else:
        detail = guarded("\u2465 detail", check_detail, cfg, cfg["model_complex"], baseline)
        known = {}
        if vision.get("image_tokens") is not None:
            known[64] = vision["image_tokens"]
        d512 = (detail.get("variants") or {}).get("\u672a\u6307\u5b9a", {}).get("image_tokens")
        if d512 is not None:
            known[512] = d512
        sizes = guarded("\u2466 \u753b\u50cf\u30b5\u30a4\u30ba", check_image_sizes, cfg, cfg["model_complex"], baseline, known)
        guarded("\u2467 WebP", check_webp, cfg, cfg["model_complex"], baseline, d512)

    guarded("\u307e\u3068\u3081", print_summary, cfg, res_chat, vision, emb, sizes, detail,
            auth, models)

    print("")
    print("=" * 70)
    print(" \u5b8c\u4e86\u3002\u4e0a\u306e\u300c\u307e\u3068\u3081\u300d\u3092 docs/00_\u5171\u901a/\u78ba\u8a8d\u4e8b\u9805.md \u00a72-1 \u306e\u7d50\u679c\u6b04\u306b\u8cbc\u3063\u3066\u304f\u3060\u3055\u3044\u3002")
    print("=" * 70)

    if args.json:
        print("")
        print("----- JSON -----")
        print(json.dumps(RESULT, ensure_ascii=False, indent=2))

    return exit_code()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\u4e2d\u65ad\u3057\u307e\u3057\u305f\u3002")
        sys.exit(130)
