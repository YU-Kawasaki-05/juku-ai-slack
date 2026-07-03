# 作業ログ: 2026-07-03（Sprint 1）

## 作業概要

Sprint 0 の DB 接続確認・ポートフォリオ公開準備（匿名化）を経て、Sprint 1「Slack Bot コア」を実装・レビュー・修正まで完了。

---

## 完了した作業

### 1. Sprint 0 後処理
- Supabase Cloud にマイグレーション 001〜019 適用、型生成、ログイン画面の動作確認（詳細は `2026-06-20_...md`）
- git init → ポートフォリオ公開準備: クライアント名を匿名化（`まるじゅく→じゅくAI`, `marujuku→juku-ai`）、秘密情報・ローカルパス除外、README 作成、初回コミット
- 匿名化マッピング等の非公開情報は `CLAUDE.local.md`（gitignore 済み）に記録

### 2. Sprint 1 実装（FR-01, 02, 03, 04, 07）
Slack メンション → 反応判定 → ジョブ登録 → ACK → バックグラウンド返信 の一連を実装。

- `POST /api/slack/events`（`src/app/api/slack/events/route.ts`）
- 署名検証 `verifySignature.ts`（HMAC-SHA256 + timingSafeEqual + タイムスタンプ鮮度）
- 反応制御 `shouldReact.ts` / `eventFacts.ts`（メンション・スレッド・紐付け判定）
- 重複排除 `eventReceipts.ts`（event_id unique）
- 紐付け解決 `lookupBinding.ts`（channel_id 基点）
- セッション `getOrCreateSession.ts` / `findSession.ts`
- ジョブ `enqueueJob.ts` / `processJob.ts` / `executeProcessMessage.ts`（waitUntil=after、claim、リトライ、🤔 リアクション）
- Slack クライアント `src/shared/lib/slack/client.ts`

### 3. 並列サブエージェント3体による敵対的レビュー → 修正
正確性 / セキュリティ / テスト網羅の3観点で並列レビューし、CONFIRMED 指摘を修正:

- **H-1（重大）**: receipt 記録後の一過性エラーで質問が恒久消失 → try/catch + receipt 削除 + 500
- **M-2**: completed 更新失敗が execute 再実行=二重返信 → 状態更新を execute の try 外へ
- **M-3**: セッション upsert が既存フィールド上書き → INSERT + 衝突時 last_message_at のみ更新
- **セキュリティ**: 署名失敗ログを DB→console.warn（未認証書き込み増幅防止）
- **仕様適合**: SLACK_EVENT_DUPLICATE(info) 記録、ラベル付きメンション対応
- **テスト健全性**: モック強化（eq/upsert 引数・delete 記録）で AC-03-03/AC-04-04/BR-07-01 を実検証化

### 検証結果
- `pnpm typecheck` エラー0 / `pnpm lint` 0 / `pnpm test` **72 pass** / `pnpm build` 成功
- コミット: `7058e82`（コア）, `0ca6422`（レビュー修正）

---

## 既知の制約（将来 Sprint で対応）

- **ジョブ孤児化**: リトライは waitUntil 内インメモリ（BR-04-06）。関数 kill 時の processing 固着を回収する JOB_TIMEOUT スイーパ未実装
- **アクセス制御**: event.user と person_id を突き合わせていない（channel メンバーシップが唯一の制御）。Sprint 2 のデータ露出前に多層防御を検討
- **FR-02 文言ドリフト**: 実装は確定版 `07_エラー文言設計.md` に準拠。FR-02 本文の旧文言は要更新

---

## 残作業（Sprint 1 完了条件の実機確認）

- タスク 1-1: Slack App 作成（Bot Token / Signing Secret / Bot User ID）← ユーザー作業
- `.env.local` に Slack 値設定 + Vercel デプロイ + Event Subscriptions URL 登録
- `seed.sql` の `<REPLACE_...>` を実チャンネル値に置換し紐付け投入
- 実機で「生徒チャンネルで Bot メンション → 15〜30秒で受付返信」を確認（完了条件）

詳細な受入手順は Sprint 2 着手前に `受入テスト_Sprint1.md` として整備予定。
