---
id: FR-20
title: スレッド長期要約
priority: P1
status: defined
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

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
