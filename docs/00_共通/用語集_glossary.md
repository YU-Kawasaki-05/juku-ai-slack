# 用語集 — juku-ai-slack-bot

| 用語 | 定義 | 補足 | 初出ドキュメント |
|------|------|------|----------------|
| 生徒 | 塾の受講生。SlackでAI Botを利用する主対象 | person_idで管理 | 01_業務理解 |
| スタッフ | 塾の指導員・運営担当者 | 管理画面も利用 | 01_業務理解 |
| 管理者 | システム全体を管理する人 | 通常はスタッフ兼任 | 01_業務理解 |
| チャンネル紐付け | SlackチャンネルIDと生徒IDの対応関係 | slack_channel_bindingsテーブルで管理 | 01_業務理解 |
| person_id | システム内での生徒識別子 | Supabase上のUUID | 01_業務理解 |
| スレッドセッション | 1つのSlackスレッドに対応するAI会話の単位 | slack_thread_sessionsテーブルで管理 | 01_業務理解 |
| 生徒プロフィール要約 | AI回答時に常時プロンプトに含める生徒の短い要約 | 500〜1500 tokens程度 | 01_業務理解 |
| RAG | Retrieval-Augmented Generation。関連チャンクを検索してAIに渡す手法 | レポートチャンクをベクトル検索で取得 | 01_業務理解 |
| チャンク | レポートをRAG用に分割したテキスト断片 | report_chunksテーブルで管理 | 01_業務理解 |
| embedding | テキストをベクトル表現に変換したもの | Supabase pgvectorで保存・検索 | 01_業務理解 |
| ACK | Acknowledgement。Slack Events APIへの即時応答 | 3秒以内に返す必要がある | 01_業務理解 |
| Vision model | 画像を読み取れるAIモデル（例: Claude claude-sonnet-4-6、GPT-4o） | 画像付き質問に使用 | 01_業務理解 |
| event_id | SlackイベントのユニークID | 重複処理防止（冪等性確保）に使用 | 01_業務理解 |
| thread_ts | Slackスレッドのタイムスタンプ識別子 | スレッドの親メッセージの時刻。スレッド特定の主キーとして使用 | 01_業務理解 |
| root_message_ts | スレッドを開始した元のメッセージのts | thread_tsと同値になることが多い | 01_業務理解 |
| Supabase | PostgreSQLベースのBaaS | DB・Auth・Storage・pgvectorを提供。インフラの中心 | 01_業務理解 |
| pgvector | PostgreSQL上でベクトル検索を行う拡張機能 | Supabaseが標準搭載 | 01_業務理解 |
| Inngest | イベント駆動の非同期ジョブ処理SaaS | 非同期処理の選択肢の一つ | 01_業務理解 |
| 月次レポート | 毎月作成する生徒の学習状況レポート | Markdown形式でDB保存 | 01_業務理解 |
| usage log | AI APIの利用量（token数・推定コスト）の記録 | ai_usage_logsテーブル | 01_業務理解 |
| error log | エラー発生時の内部詳細・ユーザー向け文言の記録 | ai_error_logsテーブル | 01_業務理解 |
| Slack Events API | Slackからイベントをリアルタイムに受信するためのWebhook仕組み | 署名検証が必要 | 01_業務理解 |
| Bot token | Slack Botの認証トークン | xoxb-xxx 形式 | 01_業務理解 |
| Signing Secret | Slack署名検証に使うシークレット | 環境変数管理必須 | 01_業務理解 |
| メンション | Slackで @BotName を含む投稿 | チャンネル直下でBotが反応する条件 | 01_業務理解 |
