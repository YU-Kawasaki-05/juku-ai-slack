# 保留TODO（着手待ち・外部依存タスク）

セッションを跨いで残る「後でやる」タスクの一覧。完了したら削除する。

## Slack App セットアップ（Sprint 1 完了条件の実機確認）— 保留中

Sprint 1 のコードは実装・テスト済み。実機で動かすには以下が必要（ユーザー作業含む）:

1. Slack App 作成
   - Bot Token（`xoxb-...`）、Signing Secret、Bot User ID を取得
   - スコープ: `chat:write`, `reactions:write`, `channels:history`（+ グループ/DM 用途に応じて）
   - Event Subscriptions を有効化し `message.channels` 等を購読
2. `.env.local` に上記 Slack 値を設定
3. Vercel へデプロイし、Event Subscriptions の Request URL に `https://<deploy>/api/slack/events` を登録（url_verification が通ること）
4. `supabase/seed.sql` の `<REPLACE_TEAM_ID>` / `<REPLACE_CHANNEL_ID>` を実値に置換して紐付け投入
5. 生徒チャンネルで Bot をメンション → 15〜30秒で受付返信が返ることを確認（Sprint 1 完了条件）

参照: `docs/05_その他/作業ログ/2026-07-03_Sprint1_slackコア実装.md`

## LLM プロバイダの確定 — 未決定

Sprint 2 時点でベンダー未確定（Anthropic / OpenRouter Fusion / DeepSeek / OpenAI など検討中）。
そのため **プロバイダ非依存の抽象化（`LlmClient` ポート）+ OpenAI 互換アダプタ** で実装している。

- 現状: OpenAI 互換 API（OpenRouter / DeepSeek / OpenAI）を `env` の `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL_DEFAULT` / `LLM_MODEL_COMPLEX` 切替で使用（コード変更不要）
- Anthropic 直（`@anthropic-ai/sdk`）にする場合は `src/features/ai-answer/lib/llm/` にアダプタを1本追加し、`getLlmClient()` に分岐を足すだけ
- **決めること**: 本番プロバイダとデフォルト/複雑モデル、実際の単価（`MODEL_PRICING` を更新）、レート制限・データ保持ポリシー
- コスト試算: 設計docの Haiku 単価（$0.25/$1.25）は旧世代。現行 `claude-haiku-4-5` は $1/$5。DeepSeek/gpt-4o-mini は更に安価。プロバイダ確定後に月次コストを再試算する

## 将来 Sprint で対応する既知の制約

- ジョブ孤児化を回収する JOB_TIMEOUT スイーパ（FR-04）
- event.user と person_id の突き合わせによる多層防御（Sprint 2 のデータ露出前）
- FR-02 本文の CHANNEL_NOT_BOUND 文言を確定版に合わせて更新（ドキュメントドリフト）
