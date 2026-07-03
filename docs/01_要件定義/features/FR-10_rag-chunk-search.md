---
id: FR-10
title: RAGチャンク検索
priority: P0
status: defined
related_users: []
related_screens: [SCR-09]
version: 1
---

# FR-10: RAGチャンク検索

## 概要

月次レポートをチャンク化してembeddingを生成・保存し、質問ごとに関連度の高いチャンクをベクトル検索で取得してAIプロンプトに含める。Supabase pgvectorを使用する。

## アクター

- システム（AI処理時に自動実行）
- U-03 管理者（管理画面から手動で Embedding 再生成も可能。ただし通常は自動実行）

## 入力データ（チャンク生成時）

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| report_id | UUID | ○ | - | チャンク生成対象のレポート |
| body_markdown | string | ○ | - | レポート本文 |

## 入力データ（検索時）

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| query_text | string | ○ | - | 質問テキスト |
| person_id | UUID | ○ | - | 該当生徒のチャンクのみ検索 |
| top_k | integer | △ | 3〜8 | デフォルト: 5 |
| similarity_threshold | float | △ | 0.0〜1.0 | デフォルト: 0.7 [仮決定] |

## 出力 / 結果

- チャンク生成: report_chunksテーブルにチャンク + embeddingを保存
- 検索: 類似度スコア付きのチャンクリストを返す（最大top_k件）

## ビジネスルール

- BR-10-01: チャンク分割はMarkdownの見出し（##, ###）単位を基本とする
- BR-10-02: 1チャンクの目安は200〜800 tokens
- BR-10-03: 検索はperson_idでフィルタする（他の生徒のチャンクを返してはならない）
- BR-10-04: is_ai_reference=falseのレポートのチャンクは検索結果から除外する
- BR-10-05: status=draftのレポートのチャンクは検索結果から除外する
- BR-10-06: 類似度がsimilarity_threshold未満のチャンクは除外する
- BR-10-07: レポート保存時（create/update）に自動で Embedding を再生成する（DEC-14）。古いチャンクは削除して再生成。完了後に `reports.embeddings_updated_at` を更新する
- BR-10-08: embeddingモデルは未定 [仮決定]

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| チャンク検索失敗（DB/ベクトル検索エラー） | REPORT_CHUNK_SEARCH_FAILED。チャンクなしでAI処理を継続（エラーとしない） |
| embeddingモデルAPIエラー | チャンクなしでAI処理を継続 |
| 有効なチャンクが0件 | 空配列を返す。AI処理は継続 |

## 受入基準（AC）

### AC-10-01: レポートのチャンク生成
```gherkin
Given 月次レポート（body_markdown 3000文字）が存在する
When チャンク生成が実行される
Then report_chunksテーブルに複数レコードが作成される
And 各チャンクにembeddingが設定される
And すべてのチャンクにperson_idが設定される
```

### AC-10-02: 類似度検索
```gherkin
Given 生徒Aのレポートが3ヶ月分チャンク化されている
When 生徒Aの「数学の二次方程式がわからない」という質問で検索する
Then 数学・二次方程式に関連するチャンクが上位に返される
And 生徒Bのチャンクは含まれない
```

### AC-10-03: similarity_threshold以下は除外
```gherkin
Given similarity_threshold=0.7 の設定
When 類似度0.65のチャンクが検索結果候補になる
Then そのチャンクは結果から除外される
```

### AC-10-04: draft/非参照レポートのチャンクは除外
```gherkin
Given status=draft のレポートのチャンクが存在する
When 検索を実行する
Then そのチャンクは検索結果に含まれない
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
