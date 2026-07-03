---
id: FR-16
title: レポート管理（管理画面）
priority: P0
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-07, SCR-08, SCR-09]
version: 1
---

# FR-16: レポート管理（管理画面）

## 概要

管理画面から月次レポートの作成・編集・公開・AI参照設定・embedding再生成を行う。

## アクター

- U-02 スタッフ（作成・編集）
- U-03 管理者（全操作・embedding再生成）

## 主要操作

1. レポート一覧表示（生徒別・月別フィルタ）
2. レポート新規作成（Markdownエディタ）
3. レポート編集
4. ステータス変更（draft ↔ published）
5. AI参照対象フラグの切り替え
6. 生徒プロフィール要約の生成・更新（AI補助）[仮決定]
7. Embedding再生成

## ビジネスルール

- BR-16-01: ステータスをpublishedにした時点でAI参照候補になる（is_ai_referenceがtrueの場合）
- BR-16-02: Embedding再生成は管理者のみ実行可能
- BR-16-03: レポートを更新した場合は「Embedding再生成が必要です」と警告を表示する（未再生成の場合）

## 受入基準（AC）

### AC-16-01: レポート作成からpublish
```gherkin
Given スタッフが新規レポートを作成する
When status=draftで保存後、status=publishedに変更する
Then is_ai_reference=trueであればRAGチャンク検索の対象になる
```

### AC-16-02: Embedding再生成
```gherkin
Given レポートが更新された
When 管理者がembedding再生成ボタンを押す
Then 既存のreport_chunksが削除されて新規作成される
And 新しいembeddingが設定される
```

### AC-16-03: レポート更新後の警告
```gherkin
Given レポートが更新されてembeddingが古くなっている
When レポート詳細ページを表示する
Then 「Embedding再生成が必要です」という警告が表示される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
