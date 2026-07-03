# 作業ログ: 2026-07-03（Sprint 3 — レポート・RAG・BKT）

## 作業概要

Sprint 2（AI回答 Tutor側）に続き、Sprint 3 の BKT 知識追跡（FR-23）と RAG（FR-10）を3増分で実装。

## 増分1: BKT 純粋ロジック + Evaluation スキーマ + 知識状態UPSERT
- `updateBKT` / `applyForgettingDecay`（FR-23 の式そのまま）
- `evaluationSchema`（Zod, reasoning先出しで CoT 強制）
- `applyEvaluation`: signal→BKT反映。skip=据え置き / unknown・低確信度スキップ / partial=誤答 / 連続正解管理 / 14日以上で忘却減衰

## 増分2: Evaluator LLM 配線
- `evaluate`: 構造化出力を prompt+Zod+1回リトライ（json_schema 非対応プロバイダ対応）
- `executeProcessMessage.runEvaluator`: 返信送信後に非同期で「直前の確認質問×生徒返信」を評価→BKT更新。失敗はサイレント（BR-23-06）、低確信度は LOW_CONFIDENCE_SKIP 記録、Evaluator 使用量も記録

## 増分3: RAG
- 埋め込みを provider-agnostic 化（`EmbeddingClient` 抽象 + OpenAI互換, EMBEDDING_* env）
- `chunkReport`（見出し単位 + 長文段落分割）
- migration 020 `match_report_chunks`（コサイン類似 + person_id/is_ai_reference/status/閾値）→ remote 適用 + 型再生成
- `searchChunks` / `rebuildReportEmbeddings`
- `buildPrompt` に ragChunks 注入（出典が分かる表現を促す, BR-05-10）
- `executeProcessMessage.searchReportChunks`: 失敗は REPORT_CHUNK_SEARCH_FAILED で継続

## 検証
- `pnpm typecheck` / `pnpm lint` / `pnpm build` 通過、`pnpm test` **148 tests pass**
- コミット: `6343521`（増分1）, `34f5800`（増分2）, `40a3da8`（増分3）

## Sprint 3.5 / 要フォロー（未対応）
- **質問時のトピック検出**: BKT は topic 別に書き込まれるが、次回質問でその topic を特定してモード選択へ反映する処理が未実装。現状モード選択は P=0.2→direct 固定
- ミッドコンバセーション・ドロップバック（AC-05-04）: Evaluator の連続 incorrect 検出→即 direct 降格（要状態連携）
- ワークド例題フェーディング F1〜F4（FR-26, P1）
- レポート保存時の embedding 自動再生成トリガ（BR-10-07）→ 管理画面レポート CRUD（Sprint 5/6）で接続

## レビュー
並列サブエージェント2体（正確性: BKT数式/RAG SQL / セキュリティ: 越境/インジェクション）→ 指摘反映（本ログはレビュー反映後に確定）。

## 残作業（外部依存）
- LLM / Embedding プロバイダ確定 + `.env.local` 設定 → 実機で RAG・BKT を確認
- 実データ（レポート）投入 + `rebuildReportEmbeddings` 実行でチャンク生成
