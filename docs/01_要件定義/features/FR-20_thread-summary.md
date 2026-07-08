---
id: FR-20
title: スレッド長期要約
priority: P1
status: implemented
related_users: [U-01, U-02]
related_screens: []
version: 1
---

# FR-20: スレッド長期要約

## 概要

スレッド内の会話が長くなった場合（10往復超）、古い履歴を要約に圧縮してトークン数を抑える。MVP後に実装。

## ビジネスルール（概要）

- 同一スレッドのメッセージ数が20件（10往復）を超えた場合に要約を生成する
- 要約はslack_thread_sessionsのthread_summaryカラムに保存する
- 要約生成後の古いメッセージはAIプロンプトから除外する

## 実装ステータス（Phase 4 が更新）

- 実装ファイル:
  - `src/features/thread-sessions/lib/summarizeThread.ts`（planSummary / buildSummaryPrompt / summarizeThread）
  - `src/features/slack-messages/lib/threadHistory.ts`（countThreadMessages / loadMessageRange）
  - `src/features/ai-answer/lib/buildPrompt.ts`（threadSummary 注入）
  - `src/features/jobs/lib/executeProcessMessage.ts`（履歴経路の切替 + 返信後の要約トリガー）
  - `supabase/migrations/025_add_summary_message_count.sql`
- テストファイル: `summarizeThread.test.ts`, `buildPrompt.test.ts`, `executeProcessMessage.test.ts`
- 最終確認Sprint: Sprint 7

### 設計（adversarial レビューで初版の欠陥を修正した最終形）

- **カバレッジ永続化**: `slack_thread_sessions.summary_message_count` に「古い方から要約済みの件数」を保持。
  履歴は「その件数以降すべて」を読むため、要約境界と直近履歴の間に**穴が空かない**
  （初版は KEEP 固定窓でリフレッシュ間に文脈欠落が生じていた）。
- **トリガー**: 「総数 − summary_message_count ≥ 20（10往復到達）」の**単調・冪等**条件。
  部分保存失敗で件数が奇数化しても発火し必ず追いつく（初版は剰余一致で奇数化すると恒久停止だった）。
- **累積更新（AC-20-02）**: 既存要約 + 新規窓（直近 10 を除いた古い分）のみを LLM に渡す（コスト有界）。
- **PII/越境（BR-05-11）**: 要約の読込・生成・UPDATE すべてに person_id を条件付与。
  チャンネル再割当てで session.person_id ≠ payload.personId のときは要約を注入も生成もしない。
- **失敗時（BR-20-04）**: 返信送信後のベストエフォート。throw せず握りつぶし、専用コード
  `THREAD_SUMMARY_FAILED`（warning）で記録。次ターンは要約なしで継続。
- 注: migration 025 の適用が前提。未適用時は要約が生成されないだけで回答フローは正常（グレースフルデグレード）。
