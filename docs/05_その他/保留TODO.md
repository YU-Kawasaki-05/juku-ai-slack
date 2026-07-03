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
- **出力モデレーション（未成年向け）**: 安全ルールはシステムプロンプト頼み。プロンプトインジェクションで
  ロール/安全指示を部分的に破られる余地がある（秘密漏洩リスクは低いがコンテンツ安全面は残存）。
  Sprint 3+ で出力側の簡易フィルタ/モデレーション導入を検討。特に FR-09 の report 由来テキストが
  profileText に流れる設計は間接インジェクション経路になり得る
- **コスト上限（per-person / kill_switch）**: 質問長は上限化したが、per-person のレート/使用量上限は未実装。1メッセージ=最大 embedding1+Tutor1+Evaluator1〜2 の LLM 課金。DEC-15 kill_switch は未コード化
- **質問時トピック検出**（FR-05/FR-23）: BKT は topic 別に書込済みだが、次回質問でその topic を特定して selectMode に反映する処理が未実装。現状は knowledgeSummary をプロンプト注入して LLM に適応させ、モード選択自体は P=0.2→direct 固定。あわせてドロップバック（AC-05-04）も要 Evaluator 連携
- **applyEvaluation の read→upsert 原子性**: 同一(person,topic)の同時評価で lost-update の可能性（発生確率低）。ON CONFLICT DO UPDATE 式 or RPC で原子化を検討
- **ワークド例題フェーディング F1〜F4**（FR-26, P1）
- **レポート保存時の embedding 自動再生成トリガ**（BR-10-07/DEC-14）→ 管理画面レポート CRUD（Sprint 5/6）で `rebuildReportEmbeddings` を接続
