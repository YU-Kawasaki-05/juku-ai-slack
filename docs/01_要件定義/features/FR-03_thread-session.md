---
id: FR-03
title: スレッドセッション管理
priority: P0
status: defined
related_users: [U-01, U-02]
related_screens: []
version: 1
---

# FR-03: スレッドセッション管理

## 概要

Slackのスレッドとシステム内のAI会話セッションを対応付けて管理する。新規質問時はセッションを作成し、スレッド内follow-upでは既存セッションを再利用する。スレッドが長くなった場合は古い履歴を要約に圧縮する。

## アクター

- システム（process_slack_messageジョブ内で呼び出し）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| slack_team_id | string | ○ | - | |
| slack_channel_id | string | ○ | - | |
| thread_ts | string | ○ | - | 新規メッセージのts（スレッド内ならthread_ts、直下ならmessage_ts） |
| person_id | string | ○ | UUID | FR-07で解決済み |
| report_id | string | △ | UUID | デフォルトレポートがある場合 |

## 出力 / 結果

- 正常系（新規）: slack_thread_sessionsに新規レコード作成。session IDを返す
- 正常系（既存）: 既存セッションレコードを返す
- セッションのthread_summaryを利用してプロンプト構築（FR-05が参照）

## ビジネスルール

- BR-03-01: thread_ts + slack_channel_idの組み合わせでセッションを一意に特定する
- BR-03-02: 新規メッセージ（チャンネル直下）はセッションを新規作成する
- BR-03-03: スレッド内メッセージで既存セッションが見つかった場合は再利用する（last_message_atを更新）
- BR-03-04: 同一スレッド内の会話が10往復（20メッセージ）を超えた場合、古い履歴をthread_summaryに圧縮することができる（MVP後回し可）
- BR-03-05: セッションのstatusが`closed`の場合は新規セッションとして扱う [仮決定]

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| DBへの保存失敗 | UNKNOWN_ERRORとして上位のエラーハンドラに委譲 |

## 受入基準（AC）

### AC-03-01: 新規スレッドセッション作成
```gherkin
Given チャンネル直下の新規メッセージ（thread_ts なし）
When process_slack_messageが実行される
Then slack_thread_sessionsに新規レコードが作成される
And root_message_ts = thread_ts = message_ts
And person_id / report_id が設定される
And status = "active"
```

### AC-03-02: 既存スレッドセッション再利用
```gherkin
Given thread_ts "1234.5678" のセッションがslack_thread_sessionsに存在する
When そのスレッドへの追加メッセージを処理する
Then 既存セッションレコードが返される（新規作成されない）
And last_message_atが更新される
```

### AC-03-03: セッション特定の一意性
```gherkin
Given 同じthread_tsを持つ2つのリクエストが同時に届く
When 両方がセッション作成を試みる
Then 1つのセッションのみが作成される（重複なし）
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
