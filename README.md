# juku-ai-slack

Slack 連携型・**生徒別 AI 学習支援ボット**。学習塾の生徒ごとに用意された Slack チャンネル上で、各生徒の学習レポート・過去のやり取り・添付画像を参照しながら、AI が「伴走者」として質問に答える。スタッフ向けの管理画面も備える。

> **Note**: これは実案件をベースにしたポートフォリオ公開版です。クライアント名・固有名詞・接続情報はすべて匿名化／除外しています。

---

## なぜ作ったか

小規模な学習塾（生徒 ~50 名）では、生徒一人ひとりの理解度に寄り添った個別指導を人手だけで回すのは難しい。一方で「AI に答えを丸投げさせる」だけでは学力は伸びない。

このプロジェクトは、教育工学の知見（**Bayesian Knowledge Tracing**、**適応的スキャフォールディング**、**Worked Example Effect**）を実装に落とし込み、「答えを教える」のではなく「理解度に応じて足場を掛け外しする」AI チューターを目指している。

## 主要な設計

| 領域 | 内容 |
|------|------|
| **知識追跡 (BKT)** | 簡易 Bayesian Knowledge Tracing で生徒×トピックごとの習熟度 P(mastery) を推定。忘却も時間減衰でモデル化 |
| **適応応答** | P(mastery) に応じて 3 モード切替：低（直接説明＋例題）／中（ソクラテス式問答）／高（確認のみ） |
| **Tutor + Evaluator 分離** | 応答生成 LLM と評価 LLM を分離。評価は Chain-of-Thought を強制する Zod スキーマで構造化 |
| **段階的フェーディング** | Worked Example を 4 段階（全提示→穴埋め→ヒントのみ→自力）で撤退 |
| **RAG** | 生徒の学習レポートを pgvector でチャンク検索し、回答の根拠に利用 |
| **エピソード記憶** | セッション終了時に事実を抽出・ベクトル保存し、次回以降の文脈に活用 |

設計判断の詳細は [`docs/`](./docs) を参照（要件定義 → 外部設計 → 技術設計の順で整理）。

## 技術スタック

- **Next.js 15** (App Router) / **React 19** / **TypeScript** (strict)
- **Supabase** (PostgreSQL + pgvector + Auth + RLS)
- **LLM はプロバイダ非依存**（OpenAI 互換 API。OpenRouter / DeepSeek / OpenAI などを env の差し替えだけで切替）
- **Slack Events API** (Bot)
- **Tailwind CSS** + **shadcn/ui**
- **Vitest** + **Playwright** + **MSW**（テスト）
- **pnpm** / **GitHub Actions**（CI）

## アーキテクチャの特徴

- `features/` ベースの高凝集ディレクトリ構成
- 全ソースに `@implements` タグを付与し、設計ドキュメントとの drift を検出可能に
- ジョブ処理は `after() + jobs テーブル`（DEC-13。Vercel Cron 非依存）
- Slack の `channel_id` を信頼の基点にした権限設計、全テーブル RLS 有効

## セットアップ

```bash
pnpm install
cp .env.example .env.local   # 各種キーを設定（必須項目は .env.example のコメント参照）

# Supabase（ローカル or クラウド）にマイグレーション適用
pnpm supabase:start          # ローカルの場合
# または: supabase link --project-ref <ref> && supabase db push

pnpm supabase:types          # DB 型を生成（ローカル Supabase）
# クラウド（supabase link 済み）の場合: pnpm supabase:types:linked

pnpm dev                     # http://localhost:3000
```

**0 からの新規セットアップ（Supabase / Slack App / Vercel / 環境変数 / 初期データ）は
[`docs/06_セットアップガイド/index.html`](./docs/06_セットアップガイド/index.html) が正本**（ステップ分割の HTML ガイド。ブラウザで開く）。

運用前に必要な設定（管理者ロール付与・Embedding・サインアップ無効化など）の詳細は
[`docs/03_技術設計/04_セットアップ手順.md`](./docs/03_技術設計/04_セットアップ手順.md) に集約している。
手順は上記 2 つを正本とし、この README では重複させない。

## 開発状況

| Sprint | 内容 | 状態 |
|--------|------|------|
| Sprint 0 | 認証・管理画面の土台・DB マイグレーション | ✅ 完了 |
| Sprint 1 | Slack イベント受信・署名検証・非同期ジョブ（FR-01〜04） | ✅ 完了 |
| Sprint 2 | AI 回答生成（適応モード）・エラー分類/ログ（FR-05, FR-11, FR-12） | ✅ 完了 |
| Sprint 3 | レポート・RAG（pgvector）・BKT 知識追跡（FR-10, FR-16, FR-23） | ✅ 完了 |
| Sprint 4 | 画像添付処理（FR-06） | ✅ 完了 |
| Sprint 5-6 | 管理画面（生徒・紐付け・レポート・エラー・利用状況・会話ログ / FR-13〜19） | ✅ 完了 |
| Sprint 7 | 管理画面の仕上げ・E2E 基盤・スレッド長期要約（FR-20） | ✅ 完了 |
| Phase 2 | エピソード記憶（FR-24）・FSRS リマインダー（FR-25）・AI 月次レポート（FR-08）・PDF 全文解析（FR-21） | 📋 計画中 |

機能単位の実装状況は [`docs/01_要件定義/_index.yml`](./docs/01_要件定義/_index.yml) の `status` が正本。
Sprint 計画の詳細は [`docs/03_技術設計/07_Sprint計画.md`](./docs/03_技術設計/07_Sprint計画.md) を参照。
Phase 2 に送った項目とその理由は [`docs/05_その他/2026-08-02_Phase2提案.md`](./docs/05_その他/2026-08-02_Phase2提案.md)。

## テスト

```bash
pnpm typecheck   # 型チェック
pnpm test        # ユニットテスト（Vitest）
pnpm lint        # ESLint
```

### E2E（Playwright）

E2E はローカル Supabase に対して回る。**`.env.local` は読まない**（`playwright.config.ts` の
`webServer.env` で `.env.test` を明示注入する）ので、本番の接続情報が混ざることはない。

```bash
pnpm supabase:start          # ポートは 5434x 帯（他プロジェクトと衝突しないよう変更済み）
pnpm supabase:reset          # migration + seed
pnpm test:e2e                # next build → playwright test
```

- env は `.env.test` を読み、無ければ `.env.test.example`（ローカル Supabase の固定値）にフォールバックする。
  値を変えたいときだけ `cp .env.test.example .env.test`。
- テスト用の admin / staff ユーザーは `e2e/global-setup.ts` が Supabase Admin API で毎回冪等に作成する
  （`app_metadata.role` を付与。seed.sql は本番想定なので触らない）。
- `test:e2e` は毎回 `next build` する。`reuseExistingServer` は CI 外でも `false` にしてあるため、
  古いビルドを配信中のサーバーを黙って使い回す事故は起きない（ポート 3200 が埋まっていれば起動失敗する）。
  ビルドを省略して回したいときだけ `pnpm test:e2e:nobuild`。
- `pnpm test:e2e` は `.next` を E2E 用の env でビルドし直すので、実行後に `pnpm start` すると
  ローカル Supabase 向けのビルドが動く。通常の開発は `pnpm dev` を使うこと。

## ライセンス

ポートフォリオ用途での公開。実運用コード・接続情報は含みません。
