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
- **Anthropic Claude** (Tutor / Evaluator)
- **Slack Events API** (Bot)
- **Tailwind CSS** + **shadcn/ui**
- **Vitest** + **Playwright** + **MSW**（テスト）
- **pnpm** / **GitHub Actions**（CI）

## アーキテクチャの特徴

- `features/` ベースの高凝集ディレクトリ構成
- 全ソースに `@implements` タグを付与し、設計ドキュメントとの drift を検出可能に
- ジョブ処理は `waitUntil + jobs テーブル`（Cron 非依存）
- Slack の `channel_id` を信頼の基点にした権限設計、全テーブル RLS 有効

## セットアップ

```bash
pnpm install
cp .env.example .env.local   # 各種キーを設定

# Supabase（ローカル or クラウド）にマイグレーション適用
pnpm supabase:start          # ローカルの場合
# または: supabase link --project-ref <ref> && supabase db push

pnpm supabase:types          # DB 型を生成
pnpm dev                     # http://localhost:3000
```

## 開発状況

| Sprint | 内容 | 状態 |
|--------|------|------|
| Sprint 0 | 認証・管理画面の土台・DB マイグレーション | ✅ 完了 |
| Sprint 1 | Slack イベント受信・チャンネル紐付け | 🚧 進行中 |
| Sprint 2〜 | AI 応答・RAG・BKT・エピソード記憶 | 📋 計画済み |

Sprint 計画の詳細は [`docs/03_技術設計/07_Sprint計画.md`](./docs/03_技術設計) を参照。

## テスト

```bash
pnpm typecheck   # 型チェック
pnpm test        # ユニットテスト（Vitest）
pnpm test:e2e    # E2E（Playwright）
pnpm lint        # ESLint
```

## ライセンス

ポートフォリオ用途での公開。実運用コード・接続情報は含みません。
