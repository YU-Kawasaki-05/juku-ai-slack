---
id: FR-18
title: 利用状況ダッシュボード
priority: P1
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-10]
version: 1
---

# FR-18: 利用状況ダッシュボード

## 概要

AI利用状況・コスト・エラー状況を可視化するダッシュボード。MVP後に実装。

## 主要表示項目

- 日別質問数
- 生徒別質問数
- チャンネル別質問数
- 画像付き質問数
- input / output / total tokens（日別・合計）
- 推定コスト（USD・合計）
- モデル別利用量
- エラー数（エラーコード別）
- レートリミット発生数

## ビジネスルール（概要）

- ai_usage_logs / ai_error_logsを集計して表示する
- 期間フィルタ（日・週・月）を提供する

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
