---
id: FR-18
title: 利用状況ダッシュボード
priority: P1
status: implemented
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

- 実装ファイル:
  - サマリー（SCR-02）: `src/app/admin/page.tsx`, `src/features/usage-logs/lib/getUsageSummary.ts`
  - 利用状況（SCR-10）: `src/app/admin/usage/page.tsx`,
    `src/features/usage-logs/lib/getUsageAnalytics.ts`,
    `src/features/usage-logs/components/{UsageCharts,UsageRangeFilter}.tsx`
- テストファイル: `src/features/usage-logs/lib/{getUsageSummary,getUsageAnalytics}.test.ts`
- 最終確認Sprint: Sprint 7

### 実装メモ（判断の記録）

- 期間フィルタは FR-18 記載の「日・週・月」ではなく **直近 7 / 30 日 / 90 日** を採用。
  塾スタッフの運用（月次レポート・コスト監視）では固定カレンダー単位より
  「直近 N 日」のほうが直感的なため。カレンダー月次が必要なら追加検討。
- チャート配色は dataviz スキルの検証済みパレット（`--viz-*`, light/dark 両対応）。
  比較は全て単色横棒＋値ラベル（colorblind-safe / contrast relief）。
- 未実装（次スプリント候補）: チャンネル別質問数、モデル別トークン内訳、
  レートリミット発生数の時系列。現状はサマリー＋主要チャートで MVP を満たす。
- SCR-02 ダッシュボードの kill_switch 状態表示（DEC-15）は kill_switch 機構自体が
  バックエンド未実装のため保留。
