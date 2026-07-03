# Sprint計画・AI駆動開発ワークフロー — juku-ai-slack-bot

## 1. Sprint運用方針

| 項目 | 設定 |
|------|------|
| 期間 | 2週間 / Sprint |
| 開発体制 | 個人開発 |
| AI利用方針 | AIメイン（Claude Code）+ セルフレビュー |
| タスク粒度 | 半日〜1日（2〜8h） |
| 完了条件 | テスト通過 + lintクリア + 動作確認済み |
| 管理 | GitHubのIssue + milestone |

---

## 2. Sprint計画

### Sprint 0: 基盤構築（2週間）
**ゴール**: 開発環境・CI/CD・空アプリがデプロイ可能な状態

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 0-1 | リポジトリ作成・初期設定（Next.js + TypeScript + ESLint + Prettier） | 2h | - | - |
| 0-2 | Supabaseプロジェクト作成・ローカル設定 | 2h | - | - |
| 0-3 | 環境変数設定・env.ts検証 | 1h | 0-1, 0-2 | - |
| 0-4 | Vercelデプロイ設定・GitHub Actions CI構築 | 3h | 0-1 | - |
| 0-5 | shadcn/ui + Tailwind セットアップ | 2h | 0-1 | - |
| 0-6 | 管理画面共通レイアウト（サイドバー・ヘッダー） | 3h | 0-5 | - |
| 0-7 | Supabase Auth設定 + middleware.ts実装 | 3h | 0-2, 0-6 | FR-13 |
| 0-8 | ログイン画面（SCR-01）実装 | 2h | 0-7 | FR-13 |
| 0-9 | DB全マイグレーション実行（001〜016） | 3h | 0-2 | 全テーブル |
| 0-10 | seedデータ投入・ローカル動作確認 | 2h | 0-9 | - |
| 0-11 | Vitest + Playwright セットアップ | 2h | 0-1 | - |

**Sprint 0 完了条件**: `https://{preview}.vercel.app/login` にアクセスでログイン画面が表示される

---

### Sprint 1: Slack Bot コア（2週間）
**ゴール**: Slackからのメンションを受け取り、スレッドに「受け付けました」と返信できる

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 1-1 | Slack App作成・Bot Token / Signing Secret取得 | 1h | - | FR-01 |
| 1-2 | `POST /api/slack/events` 署名検証実装 | 3h | 0-9 | FR-01 |
| 1-3 | url_verification対応 | 1h | 1-2 | FR-01 |
| 1-4 | slack_event_receipts 重複チェック実装 | 2h | 1-2 | FR-01 |
| 1-5 | jobs テーブルへのジョブ登録実装 | 2h | 1-2 | FR-04 |
| 1-6 | 反応制御ロジック実装（メンション判定・スレッド判定） | 4h | 1-2 | FR-02 |
| 1-7 | `waitUntil` + jobs テーブルのWorker基盤実装（DEC-13） | 3h | 1-5 | FR-04 |
| 1-8 | channel_id → person_id解決処理 | 2h | 1-7 | FR-07 |
| 1-9 | スレッドセッション作成・取得実装 | 3h | 1-7 | FR-03 |
| 1-10 | Slack返信関数実装（`chat.postMessage`） | 2h | 1-7 | FR-05 |
| 1-11 | Unit tests: 署名検証・反応制御 | 3h | 1-2, 1-6 | AC-01, AC-02 |
| 1-12 | Integration tests: Webhook受信フロー | 3h | 1-7 | AC-01〜04 |

**Sprint 1 完了条件**: 生徒チャンネルでBotをメンションすると15〜30秒で「受け付けました（テスト返信）」が返る

---

### Sprint 2: AI回答生成 + エラー基盤（2週間）
**ゴール**: 実際にAIが質問に回答できる（適応型戦略含む）

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 2-1 | LLM API クライアント実装（Anthropic SDK） | 3h | S1 | FR-05 |
| 2-2 | プロンプトビルダー実装（システムプロンプト + プロフィール + 履歴 + P(mastery)注入） | 4h | 2-1 | FR-05, FR-23 |
| 2-3 | AI回答生成 → Slack返信フロー完成 | 3h | 2-2 | FR-05 |
| 2-4 | エラーコード定義・エラーハンドラ実装（07_エラー文言設計.md 準拠） | 3h | 2-3 | FR-11 |
| 2-5 | ai_error_logs保存実装 | 2h | 2-4 | FR-11 |
| 2-6 | usage log保存実装（コスト計算含む） | 2h | 2-3 | FR-12 |
| 2-7 | エラー時のSlack返信文言実装（userMessages.ts） | 2h | 2-4 | FR-11 |
| 2-8 | ジョブリトライ実装（max_attempts） | 2h | S1 | FR-04 |
| 2-9 | P(mastery)3モード切替ロジック実装（direct/socratic/confirmation） | 4h | 2-2 | FR-05, DEC-23 |
| 2-10 | ワークド例題プロンプトテンプレート実装（FR-26 Backward Fading F1〜F4） | 3h | 2-9 | FR-26 |
| 2-11 | 🤔リアクション追加・削除実装（reactions.add / reactions.remove） | 2h | 2-3 | AC-01-06 |
| 2-12 | Unit tests: プロンプトビルダー・モード切替・コスト計算 | 4h | 2-2, 2-9, 2-6 | AC-05, AC-12 |
| 2-13 | MSW設定 + Integration tests: AI回答フロー・適応型戦略 | 5h | 2-3, 2-9 | AC-05-01〜06 |

**Sprint 2 完了条件**: 「数学の問題がわかりません」と質問したら P(mastery) に応じて適応型の回答が返る

---

### Sprint 3: レポート・RAG・BKT（2週間）
**ゴール**: 生徒のレポートをAIが参照して回答できる。BKTで習熟度を追跡する。

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 3-1 | Embedding APIクライアント実装 | 2h | S2 | FR-10 |
| 3-2 | レポートチャンク分割ロジック実装 | 3h | 3-1 | FR-10 |
| 3-3 | Supabase pgvector検索関数実装 | 3h | 3-2 | FR-10 |
| 3-4 | 生徒プロフィール要約のプロンプト組み込み | 2h | S2 | FR-09 |
| 3-5 | RAGチャンクのプロンプト組み込み | 2h | 3-3 | FR-10 |
| 3-6 | スレッド履歴のプロンプト組み込み | 2h | S2 | FR-03 |
| 3-7 | updateBKT() + applyForgettingDecay() 実装（TypeScript純実装） | 2h | S2 | FR-23 |
| 3-8 | Evaluator LLM実装（Zod EvaluationSchema、reasoning → signal → misconception） | 4h | 3-7 | FR-23, DEC-24 |
| 3-9 | signal=skip → BKT完全据え置き処理 | 1h | 3-8 | FR-23, DEC-24 |
| 3-10 | student_knowledge_states UPSERT・forgetting decay 適用 | 2h | 3-7 | FR-23 |
| 3-11 | Integration tests: RAGチャンク検索・プロフィール組み込み | 3h | 3-3, 3-4 | AC-10, AC-09 |
| 3-12 | Unit tests: updateBKT・skip処理・EvaluationSchema | 3h | 3-7, 3-8, 3-9 | AC-23-01〜07 |

**Sprint 3 完了条件**: レポート参照回答が動作し、Evaluatorが正誤シグナルを抽出してBKT値が更新される

---

### Sprint 4: 画像対応（2週間）
**ゴール**: 画像付き質問に対応できる

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 4-1 | Slackファイル情報取得実装 | 2h | S2 | FR-06 |
| 4-2 | Bot tokenでの画像ダウンロード実装 | 2h | 4-1 | FR-06 |
| 4-3 | Supabase Storage保存実装 | 2h | 4-2 | FR-06 |
| 4-4 | attachmentsテーブルへのメタデータ保存 | 1h | 4-3 | FR-06 |
| 4-5 | Vision対応モデルへの画像渡し実装 | 3h | 4-2 | FR-06 |
| 4-6 | ファイル形式・サイズバリデーション | 2h | 4-1 | FR-06 |
| 4-7 | Unit tests: ファイルバリデーション | 2h | 4-6 | AC-06 |
| 4-8 | Integration tests: 画像処理フロー | 3h | 4-5 | AC-06 |

**Sprint 4 完了条件**: 問題用紙の写真を添付して質問したら回答が返る

---

### Sprint 4b: エピソード記憶（2週間）
**ゴール**: セッション終了後に事実を自動抽出し、次回会話で記憶を参照できる（DEC-21）

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 4b-1 | セッション終了検出（30分無操作）の実装 | 3h | S3 | FR-24 |
| 4b-2 | セッション終了後の事実抽出 LLM 実装（重要度1〜10スコア付き） | 4h | 4b-1 | FR-24 |
| 4b-3 | student_episodic_memories への pgvector embedding 保存 | 3h | 4b-2 | FR-24 |
| 4b-4 | superseded_by パターンでの記憶更新実装 | 2h | 4b-3 | FR-24 |
| 4b-5 | ブートシーケンス: 重要度≥7 の記憶をシステムプロンプトに組み込む | 3h | 4b-3 | FR-24 |
| 4b-6 | Anthropicプロンプトキャッシュ設定（cache_control: ephemeral） | 2h | 4b-5 | FR-24, DEC-21 |
| 4b-7 | Unit tests: 事実抽出・重要度スコア | 3h | 4b-2 | FR-24 |
| 4b-8 | Integration tests: 記憶保存→次セッション注入フロー | 3h | 4b-5 | FR-24 |

**Sprint 4b 完了条件**: 「先週話した数学の苦手な内容を覚えてる」とBotが答えられる

---

### Sprint 5: 管理画面 基本機能（2週間）
**ゴール**: 生徒・チャンネル・プロフィールを管理画面から操作できる

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 5-1 | Admin API共通ミドルウェア（認証・ロール） | 2h | S0 | FR-13 |
| 5-2 | 生徒CRUD API (EP-02〜05) | 4h | 5-1 | FR-14 |
| 5-3 | 生徒一覧画面（SCR-03）実装 | 3h | 5-2 | FR-14 |
| 5-4 | 生徒詳細・編集画面（SCR-04）実装 | 4h | 5-2 | FR-14 |
| 5-5 | プロフィール要約 API (EP-06) + UI | 3h | 5-4 | FR-09 |
| 5-6 | チャンネル紐付けAPI (EP-07〜09) | 3h | 5-1 | FR-15 |
| 5-7 | チャンネル紐付け画面（SCR-05,06）実装 | 4h | 5-6 | FR-15 |
| 5-8 | E2E tests: 生徒登録・チャンネル紐付け | 4h | 5-4, 5-7 | AC-14, AC-15 |

**Sprint 5 完了条件**: 管理画面から新規生徒を登録し、Slackチャンネルと紐付けできる

---

### Sprint 6: 管理画面 レポート・エラー管理（2週間）
**ゴール**: レポートとエラーを管理画面から操作できる。MVP完成。

| # | タスク | 見積 | 依存 | 関連FR |
|---|--------|------|------|--------|
| 6-1 | レポートCRUD API (EP-10〜13) | 4h | 5-1 | FR-16 |
| 6-2 | レポート一覧・詳細画面（SCR-07,09）実装 | 4h | 6-1 | FR-16 |
| 6-3 | レポート作成・編集画面（SCR-08）実装（Markdownエディタ） | 4h | 6-1 | FR-16 |
| 6-4 | Embedding再生成 API (EP-14) + UIボタン | 4h | 6-2, S3 | FR-10 |
| 6-5 | エラー管理 API (EP-16,17) | 2h | 5-1 | FR-17 |
| 6-6 | エラー一覧・詳細画面（SCR-11,12）実装 | 4h | 6-5 | FR-17 |
| 6-7 | ダッシュボードTOP（SCR-02）実装 | 2h | 6-5 | - |
| 6-8 | E2E tests: レポート作成・公開・Embedding再生成 | 4h | 6-4 | AC-16 |
| 6-9 | E2E tests: エラー一覧・対応済みマーク | 2h | 6-6 | AC-17 |
| 6-10 | 全体テスト通過確認・バグ修正 | 4h | 全 | - |

**Sprint 6 完了条件**: MVP P0機能が全て動作する

---

## 3. AI指示テンプレート

### 3.1 Sprint開始時テンプレート

```
## Sprint {N} 開始

### 対象機能
- FR-XX: {機能名}
- 関連AC: AC-XX-01, AC-XX-02, ...

### 必ず読むファイル
1. docs/01_要件定義/features/FR-XX.md
2. docs/02_外部設計/02_API仕様.md の EP-XX
3. docs/02_外部設計/06_テスト戦略.md のAC-XXのテスト対応
4. docs/03_技術設計/05_開発ガイドライン.md（@implements規約）
5. docs/03_技術設計/02_ディレクトリ構成.md

### 制約
- ファイル冒頭に @implements FR-XX, AC-XX-XX タグ必須
- features/slack/ 配下に配置（ディレクトリ構成に従う）
- エラーはappError型で統一
- 外部API（Slack/LLM）はMSWでモック
```

### 3.2 タスク単位テンプレート

```
## タスク: {タスク名}

### 何を作るか
- src/features/{name}/actions/{file}.ts
- src/features/{name}/actions/{file}.test.ts

### 入出力
参照: docs/02_外部設計/02_API仕様.md #{EP-XX}

入力（リクエスト）:
{具体的な型/JSON}

出力（レスポンス）:
{具体的な型/JSON}

### データ構造（Zodスキーマ）
{スキーマを貼る}

### 受入基準
{FR-XX.mdのAC-XX-XXをここに貼る}

### やらないこと
- UIは今Sprint外
- 認証チェックは共通ミドルウェアに任せる

### セキュリティチェック
- [ ] person_idはchannel_idから解決しているか（クライアント値を信用しない）
- [ ] Service Role Keyをクライアントに渡していないか
- [ ] エラー時に内部詳細をSlackに返していないか
```

---

## 4. featureの標準実装フロー

```
1. src/features/{name}/types.ts
   └─ 型定義・Zodスキーマ

2. src/features/{name}/actions/{action}.ts
   └─ ビジネスロジック（@implements タグ付き）

3. src/features/{name}/actions/{action}.test.ts
   └─ Unit/Integrationテスト（@verifies AC-XX タグ付き）

4. src/features/{name}/components/{Component}.tsx
   └─ UIコンポーネント

5. src/app/{route}/page.tsx
   └─ ページ統合（Server Component）

6. tests/e2e/{feature}/{flow}.spec.ts
   └─ E2Eテスト

7. PRレビュー + マージ
```
