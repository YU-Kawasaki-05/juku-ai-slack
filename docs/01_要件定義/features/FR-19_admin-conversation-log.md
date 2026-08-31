---
id: FR-19
title: 会話ログ閲覧
priority: P1
status: implemented
related_users: [U-02, U-03]
related_screens: [SCR-13]
version: 1
---

# FR-19: 会話ログ閲覧

## 概要

Slackスレッド単位の会話を管理画面から閲覧できる。MVP後に実装。

## 主要機能

- スレッド一覧表示
- 生徒別・チャンネル別・期間フィルタ
- 画像有無・使用モデル・token数・エラー有無での絞り込み
- 各スレッドのメッセージ詳細表示

## 実装ステータス（Phase 4 が更新）

- 実装ファイル:
  - `src/features/conversation-logs/lib/getConversations.ts`（一覧・詳細取得）
  - `src/features/conversation-logs/components/ConversationsFilter.tsx`
  - `src/app/admin/conversations/{page,[id]/page}.tsx`
- テストファイル: `src/features/conversation-logs/lib/getConversations.test.ts`
- 最終確認Sprint: Sprint 7

### 実装メモ（判断の記録）

- スレッド一覧（生徒名・チャンネル名・件数・要約・最終時刻）+ 詳細（メッセージ時系列の
  チャット表示）を実装。フィルタは生徒・期間（全期間/7/30/90日）。
- 主要機能のうち MVP スコープを絞った点（今後の候補）: 「画像有無・使用モデル・token 数・
  エラー有無での絞り込み」は未実装（一覧の絞り込み軸は生徒・期間のみ）。
  詳細では画像添付の有無をバッジ表示。
- 会話本文は PII。閲覧は staff/admin のみ（middleware + ページ認証）。
  詳細取得は person_id + channel_id + thread_ts で厳密に絞り別生徒の混入を防止（BR-05-11）。
- SCR-13 の独立した画面仕様は 04_画面設計.md に未記載のため、本 FR の主要機能リストに準拠。
