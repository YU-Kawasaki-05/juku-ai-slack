# Slack連携型・生徒別AI学習支援Bot 開発仕様メモ

## 0. 目的

Slack上で、生徒ごとの個別チャンネルに配置されたAI Botが、生徒またはスタッフからの質問に対して、各生徒の学習レポート・過去のスレッド履歴・添付画像を参照しながら回答するシステムを作る。

独自UIでのチャット表示は一旦主目的ではない。主UIはSlackとする。
ただし、管理画面は必要。管理画面では、生徒・Slackチャンネル・レポート・利用状況・トークン消費・エラー状況を確認・管理できるようにする。

## 1. 想定ユーザー

### 回答を受ける主対象

基本的には生徒本人向け。

### 利用する人

* 生徒本人
* 塾スタッフ
* 管理者

スタッフも同じ生徒専用Slackチャンネル内で質問することがある。
ただし、AIの回答トーンは原則として「本人にも読める、やさしく丁寧な説明」を基本にする。

スタッフが明示的に「スタッフ向けに」「指導方針として」などと書いた場合は、スタッフ向けの補足をしてよい。

## 2. Slack運用前提

* 生徒ごとに個別Slackチャンネルが存在する。
* 1チャンネル = 1生徒、という対応関係を基本とする。
* Botは各チャンネルに参加している。
* 通常のチャンネル直下の投稿では、Botへのメンションがある場合のみ反応する。
* Botが作った、またはBotが紐付けたスレッド内では、追加質問に対してメンションなしでも反応してよい。
* スタッフ同士の雑談や運用メモに勝手に反応しないことを重視する。

## 3. 基本動作

### 新規質問

1. ユーザーが生徒専用チャンネルでBotをメンションして質問する。
2. Slack Events APIでイベントを受け取る。
3. 署名検証を行う。
4. event_id等で重複判定を行う。
5. すぐにSlackへACKを返す。
6. 非同期ジョブとしてAI処理を開始する。
7. channel_idからperson_id / report_idを特定する。
8. 質問本文と添付画像を取得する。
9. 生徒レポート、関連チャンク、同一スレッド履歴を取得する。
10. AIに問い合わせる。
11. Slackの元メッセージに対してthread_ts付きで返信する。
12. usage log / token log / error logを保存する。

### スレッド内follow-up

1. ユーザーが既存AIスレッド内に追加質問する。
2. `slack_thread_sessions` から既存の会話セッションを特定する。
3. 同じperson_id / report_id / thread contextで処理する。
4. 同じSlackスレッドに返信する。
5. 履歴とusage logを保存する。

## 4. 反応ルール

### チャンネル直下

Botメンション必須。

### スレッド内

以下の条件を満たす場合はメンションなしでも反応する。

* そのスレッドが過去にBotによって作成・処理されたスレッドである
* `slack_thread_sessions` に登録済みである
* Bot自身の投稿ではない
* システム的に無視すべき subtype ではない

### 無視するもの

* Bot自身のメッセージ
* message_changed / message_deleted など、MVPで扱わないイベント
* チャンネル直下でBotメンションがない投稿
* 対応外ファイルのみの投稿
* 紐付けのないチャンネル

## 5. レポート管理

レポートはSupabase上に保存する方針。

### レポートの性質

* 生徒ごとの学習状況レポート
* かなり細かくてよい
* 毎月同じ書式で見られることが重要
* AI回答の参考情報として使う
* ただし、AIが一般知識を使うことも許可する

### レポートの標準フォーマット案

月次レポートは以下のような構造に統一する。

```md
# 月次学習レポート

## 基本情報
- 生徒名:
- 対象月:
- 学年:
- 担当者:
- レポート作成日:

## 今月の総評
短い総評。本人にも読めるトーンで書く。

## 学習状況サマリー
- 学習時間:
- 出席状況:
- 宿題提出状況:
- 演習量:
- 定着度:

## 科目別状況

### 数学
- 現在の単元:
- 理解度:
- 得意な点:
- 苦手な点:
- よくあるミス:
- 次にやるべきこと:

### 英語
同上

### その他科目
必要に応じて追加

## 直近の課題
- 課題1:
- 課題2:
- 課題3:

## 指導上の注意点
本人のモチベーション、説明の粒度、声かけの注意など。

## 次月の方針
- 重点単元:
- 学習計画:
- 目標:
- 注意点:

## AI回答時の補足メモ
AIが質問対応するときに参考にすべき情報。
例: 「抽象的な説明より例題ベースがよい」「途中式を丁寧に出す」など。
```

## 6. レポート参照・RAG方針

毎回レポート全文をLLMに渡さない。
トークン効率と精度のため、以下の3層構造にする。

### 6.1 生徒プロフィール要約

各生徒ごとに、常にプロンプトへ入れる短い要約を持つ。

内容:

* 現在の学習状況
* 苦手分野
* 得意分野
* 指導上の注意
* 説明トーン
* 直近の重点課題

目安: 500〜1500 tokens程度。

### 6.2 レポートチャンク検索

月次レポートや過去資料をチャンク化し、embeddingを保存する。
質問ごとに関連度の高いチャンクのみ取得する。

目安:

* 上位3〜8チャンク
* 類似度閾値を設定
* 必要なら科目・月・report_idでfilterする

### 6.3 スレッド履歴

同じSlackスレッド内の直近会話を入れる。
スレッドが長くなった場合は、古い履歴をスレッド要約に圧縮する。

## 7. 画像対応

画像対応は必須。

### 想定画像

* 問題文のスクショ
* 問題集やプリントの写真
* 手書きノート
* 手書き計算
* 模試や小テストの一部
* 表や図を含む画像

### MVPで対応するもの

* jpg
* jpeg
* png
* webp
* 画像1〜3枚程度

### 後回しでよいもの

* PDF全文解析
* 動画
* 音声
* 大量画像
* 複数ページPDF
* 画像内の個人情報マスキング自動化

### 画像処理方針

1. Slack file objectから画像URLを取得する。
2. Bot tokenで画像をダウンロードする。
3. 必要に応じて圧縮・リサイズする。
4. Supabase StorageまたはS3に保存する。
5. AI vision対応モデルに画像を渡す。
6. 画像メタデータをattachmentsテーブルに保存する。

OCRを先にかけるより、最初はvision modelに直接渡す方針でよい。
ただし、将来的に問題文抽出・再利用・検索をしたい場合はOCRテキストも保存できる設計にしておく。

## 8. AI回答方針

### 基本トーン

* 生徒本人向け
* やさしい
* 丁寧
* 途中式や考え方を大切にする
* 断定しすぎない
* 必要に応じて励ます
* ただし、過度に馴れ馴れしくしない

### 回答構成

Slack上で読みやすくするため、以下を基本形にする。

```txt
結論
→ 考え方
→ 解き方・手順
→ 注意点
→ 次にやるとよいこと
```

長すぎる回答は避ける。
ただし、問題解説では必要な途中式・手順は省略しすぎない。

### レポート参照時の言い方

レポートに基づく内容と一般知識を区別できるようにする。

例:
「今月のレポートを見る限り、計算ミスよりも問題文の読み取りでつまずくことが多そうです。なので今回は、式を立てる前に条件を整理するところからやってみましょう。」

### 禁止・注意

* 他の生徒の情報を出さない
* 内部エラーやスタックトレースを出さない
* APIキーや内部IDを出さない
* 成績や能力を強く断定しない
* 医療・心理診断のようなことはしない
* レポートにないことを、レポートに書いてあるかのように言わない
* 画像が読めない場合に推測で断定しない

## 9. 管理画面

管理画面は必要。
利用者は管理者本人と塾スタッフ。

### 管理画面で必要な機能

#### 9.1 生徒管理

* 生徒一覧
* 生徒名
* person_id
* 所属
* ステータス
* 最新レポート
* 紐付いているSlackチャンネル
* 最終利用日時
* 累計質問数
* 累計トークン

#### 9.2 Slackチャンネル紐付け管理

* slack_team_id
* slack_channel_id
* slack_channel_name
* person_id
* person_name
* report_id
* 有効/無効
* 最終イベント日時
* Bot稼働状態

channel_nameは表示用。真のキーはslack_channel_id。

#### 9.3 レポート管理

* 月次レポート一覧
* 生徒別レポート一覧
* レポート作成・編集
* レポートの公開/非公開
* AI参照対象にするか
* レポート要約の生成・更新
* embeddings再生成

#### 9.4 利用状況ダッシュボード

* 日別質問数
* 生徒別質問数
* チャンネル別質問数
* 画像付き質問数
* input tokens
* output tokens
* total tokens
* 推定コスト
* モデル別利用量
* エラー数
* レートリミット発生数

#### 9.5 エラー管理

* エラー一覧
* エラーコード
* 発生日時
* 生徒名
* チャンネル名
* スレッドURL
* ユーザーに返した文言
* 内部エラー詳細
* retry可能か
* 対応済みフラグ
* メモ欄

#### 9.6 会話ログ

* Slackスレッド単位の会話一覧
* 生徒別フィルタ
* チャンネル別フィルタ
* 期間フィルタ
* 画像有無
* 使用モデル
* token数
* エラー有無

## 10. DB設計案

### persons

生徒情報。

```txt
id
name
display_name
grade
status
created_at
updated_at
```

### student_profiles

AI用の生徒プロフィール要約。

```txt
id
person_id
summary
learning_style
strengths
weaknesses
instruction_notes
updated_at
```

### reports

月次レポート本体。

```txt
id
person_id
title
report_month
body_markdown
status
created_by
created_at
updated_at
```

### report_chunks

RAG用チャンク。

```txt
id
report_id
person_id
chunk_index
content
embedding
metadata
created_at
```

### slack_channel_bindings

Slackチャンネルと生徒・レポートの対応表。

```txt
id
slack_team_id
slack_channel_id
slack_channel_name
person_id
person_name_snapshot
default_report_id
status
created_at
updated_at
```

### slack_thread_sessions

SlackスレッドとAI会話セッションの対応。

```txt
id
slack_team_id
slack_channel_id
root_message_ts
thread_ts
person_id
report_id
status
thread_summary
created_at
updated_at
last_message_at
```

### slack_messages

Slackメッセージログ。

```txt
id
slack_team_id
slack_channel_id
thread_ts
message_ts
slack_user_id
person_id
role
text
has_attachments
raw_event
created_at
```

### attachments

添付ファイル情報。

```txt
id
slack_file_id
slack_channel_id
thread_ts
message_ts
person_id
file_type
mime_type
original_name
storage_path
file_size
width
height
status
created_at
```

### ai_usage_logs

AI利用ログ。

```txt
id
person_id
slack_channel_id
thread_ts
message_ts
model
input_tokens
output_tokens
total_tokens
estimated_cost
has_image
latency_ms
created_at
```

### ai_error_logs

エラーログ。

```txt
id
error_code
severity
provider
person_id
slack_channel_id
thread_ts
message_ts
user_facing_message
internal_message
raw_error
retryable
resolved
created_at
updated_at
```

### slack_event_receipts

Slackイベント重複防止。

```txt
id
event_id
slack_team_id
event_type
event_ts
received_at
processed_at
status
```

### jobs

非同期処理ジョブ。

```txt
id
job_type
status
payload
attempt_count
max_attempts
scheduled_at
started_at
finished_at
error_code
created_at
updated_at
```

## 11. API / 処理設計

### POST /api/slack/events

Slack Events APIの受信口。

責務:

* Slack署名検証
* url_verification対応
* event_id重複チェック
* 対象イベントか判定
* job登録
* すぐACKを返す

ここでAI処理までやらない。

### job: process_slack_message

Slackメッセージを処理する非同期ジョブ。

責務:

* binding取得
* thread session取得または作成
* 添付ファイル取得
* レポート・プロフィール・チャンク取得
* AI prompt作成
* AI実行
* Slackに返信
* usage log保存
* error log保存

### admin APIs

必要に応じて以下を用意する。

* GET /api/admin/persons
* GET /api/admin/slack-channel-bindings
* POST /api/admin/slack-channel-bindings
* PATCH /api/admin/slack-channel-bindings/:id
* GET /api/admin/reports
* POST /api/admin/reports
* PATCH /api/admin/reports/:id
* POST /api/admin/reports/:id/rebuild-embeddings
* GET /api/admin/usage
* GET /api/admin/errors
* PATCH /api/admin/errors/:id
* GET /api/admin/slack-threads

## 12. エラー設計

ユーザーに内部エラーを出さない。
エラーごとにユーザー向け文言と内部ログを分ける。

### エラーコード案

```txt
CHANNEL_NOT_BOUND
PERSON_NOT_FOUND
REPORT_NOT_FOUND
REPORT_CHUNK_SEARCH_FAILED
SLACK_SIGNATURE_INVALID
SLACK_EVENT_DUPLICATE
SLACK_FILE_DOWNLOAD_FAILED
UNSUPPORTED_FILE_TYPE
IMAGE_TOO_LARGE
IMAGE_PROCESSING_FAILED
AI_RATE_LIMITED
AI_TIMEOUT
AI_RESPONSE_FAILED
TOKEN_BUDGET_EXCEEDED
SLACK_POST_FAILED
JOB_TIMEOUT
UNKNOWN_ERROR
```

### ユーザー向け文言例

CHANNEL_NOT_BOUND:
「このチャンネルに対応する生徒情報がまだ設定されていないようです。管理者に確認してください。」

SLACK_FILE_DOWNLOAD_FAILED:
「添付画像の取得に失敗しました。少し時間を置いて再送するか、別の画像で試してください。」

UNSUPPORTED_FILE_TYPE:
「このファイル形式にはまだ対応していません。画像の場合は jpg / png 形式で送ってください。」

AI_RATE_LIMITED:
「ただいまAIの利用が混み合っています。少し時間を置いてもう一度質問してください。」

AI_TIMEOUT:
「回答生成に時間がかかりすぎたため、途中で停止しました。質問を少し短くしてもう一度送ってください。」

UNKNOWN_ERROR:
「すみません、処理中に問題が発生しました。管理者が確認できるように記録しました。」

## 13. トークン・コスト最適化

### 方針

* 毎回レポート全文を入れない
* 生徒プロフィール要約を常時入れる
* 関連チャンクだけをRAGで入れる
* スレッド履歴は直近数往復に制限
* 長いスレッドは要約に畳む
* 画像は必要枚数だけ処理
* 画像サイズを圧縮する
* モデルを用途別に使い分ける

### モデル使い分け案

* 通常テキスト回答: 安価・高速なモデル
* 画像あり質問: vision対応モデル
* レポート要約生成: 安価なモデル
* 複雑な問題解説: 高性能モデル
* embeddings: 専用embeddingモデル

### 保存すべきusage

* model
* input_tokens
* output_tokens
* total_tokens
* estimated_cost
* has_image
* person_id
* channel_id
* thread_ts
* latency_ms

## 14. セキュリティ・権限

* Slack署名検証は必須。
* Bot token / signing secret / AI API key は環境変数管理。
* 管理画面はスタッフ権限必須。
* 生徒間の情報混入を防ぐ。
* channel_idベースで必ずperson_idを解決する。
* channel_nameだけで判定しない。
* Slack Connectや外部共有チャンネルはMVPでは原則対象外。
* ログにAPIキーや機密情報を保存しない。
* raw_errorの保存は必要だが、管理画面表示時にマスキングを検討する。

## 15. インフラ方針

### 第一候補

* Vercel
* Supabase Postgres
* Supabase Storage
* Supabase pgvector
* Slack Events API
* OpenAI等のLLM API

### 非同期処理

Slack Events APIのACKとAI処理は分離する。
Vercel上で受けたイベントをjob tableに保存し、別workerで処理する。

選択肢:

* Supabase job table + scheduled worker
* Inngest
* QStash
* AWS SQS + worker

まったり開発なら最初はSupabase job tableでもよい。
運用安定性を重視するならInngest/QStash等を検討する。

## 16. MVP範囲

### MVPに含める

* Slackメンション受信
* Slackスレッド返信
* スレッド内follow-up
* チャンネルと生徒の紐付け
* Supabase上のレポート保存
* 生徒プロフィール要約
* 同一スレッド履歴
* 画像添付対応
* 基本エラー分類
* usage log
* 管理画面の最小版

### MVP管理画面

* 生徒一覧
* チャンネル紐付け一覧
* レポート一覧
* 利用状況の簡易表示
* エラー一覧

### MVPで後回し

* PDF全文解析
* 高度なダッシュボード
* 再実行UI
* 複数workspace対応
* Slackメッセージ編集/削除同期
* 高度な権限管理
* OCR全文検索
* 複雑な請求・コスト配賦

## 17. 開発フェーズ案

### Phase 1: Slack Bot核

* Slack app作成
* Events API受信
* 署名検証
* メンション反応
* スレッド返信
* channel binding
* usage/error log

### Phase 2: レポート・画像対応

* reportsテーブル
* student profile summary
* image download/storage
* vision model連携
* 基本RAG
* prompt整備

### Phase 3: 管理画面

* 生徒管理
* チャンネル紐付け管理
* レポート管理
* 利用状況
* エラー管理

### Phase 4: 品質改善

* token最適化
* retry
* dashboard改善
* prompt改善
* テスト
* 監視
* 運用ドキュメント

## 18. 工数感

画像対応と管理画面を含める場合、単なるSlack Botより工数は大きい。

### 実用MVP

1.0〜1.5人月程度。

### ちゃんと作り込む版

2.0〜3.0人月程度。

### まったり高品質に育てる場合

3フェーズ以上に分け、最初にログとDB設計を丁寧に作る。
UIの美しさやダッシュボードは後から作り込む。ただし、usage log / error log / event logは最初から保存する。

## 19. 実装上の重要方針

* Slackを主UIにする。
* 独自チャットUIは一旦前提にしない。
* 各Slackチャンネルを生徒専用ルームとして扱う。
* channel_idを信頼する。channel_nameは表示用。
* AI回答は本人向けを基本にする。
* レポートは毎月同じ形式で作る。
* RAGで必要箇所だけ参照し、トークンを節約する。
* 画像対応は必須。
* エラーは必ず分類し、ユーザー向け文言と内部ログを分ける。
* 管理画面は必要。
* 利用状況とコストは最初からログとして保存する。
* まずはMVPを作り、その後ダッシュボードやUXを磨く。

## 20. 未確定だが後で決めること

* 使用するLLMモデル
* embeddingsモデル
* 画像保存先をSupabase StorageにするかS3にするか
* 非同期job基盤を何にするか
* 管理画面のUIデザイン方針
* スタッフ権限の粒度
* PDF対応の優先度
* レポート作成を手入力にするか、AI補助するか
* 月次レポートの最終フォーマット
