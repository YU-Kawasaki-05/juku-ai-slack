---
id: FR-02
title: メンション・反応制御
priority: P0
status: defined
related_users: [U-01, U-02]
related_screens: []
version: 1
---

# FR-02: メンション・反応制御

## 概要

受信したSlackメッセージイベントを解析し、Botが反応すべきかどうかを判定する。チャンネル直下ではBotメンションが必須。Botが作成・処理したスレッド内ではメンションなしでも反応する。

## アクター

- U-01 生徒（Slackでメッセージを送る）
- U-02 スタッフ（Slackでメッセージを送る）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| event.channel | string | ○ | - | SlackチャンネルID |
| event.thread_ts | string | △ | - | スレッド内メッセージの場合のみ存在 |
| event.text | string | △ | - | メッセージ本文 |
| event.subtype | string | △ | - | subtypeがある場合は基本的に無視 |
| event.bot_id | string | △ | - | Bot自身のメッセージに付与される |
| event.user | string | △ | - | 送信ユーザーのSlack User ID |
| slack_channel_bindings.status | string | ○ | active/inactive | 該当チャンネルの紐付け状態 |
| slack_thread_sessions | record | △ | - | スレッドの登録状況 |

## 出力 / 結果

- 正常系（反応する）: process_slack_messageジョブを実行する
- 正常系（無視する）: 何もしない（エラーなし、ログなし）
- 異常系（チャンネル紐付けなし）: CHANNEL_NOT_BOUND エラーをSlackに返信

## ビジネスルール

- BR-02-01: Bot自身のメッセージ（bot_idが存在する）には反応しない
- BR-02-02: message_changed / message_deleted 等のsubtypeは無視する（MVPスコープ外）
- BR-02-03: チャンネル直下（thread_tsなし）の投稿は、BotのSlack User IDへのメンション（`<@BOT_USER_ID>`）が含まれる場合のみ反応する
- BR-02-04: スレッド内（thread_tsあり）の投稿は、そのthread_tsがslack_thread_sessionsに登録済みの場合、メンションなしでも反応する
- BR-02-05: slack_channel_bindingsに存在しない、またはstatus=inactiveのチャンネルからのメッセージには反応せず、CHANNEL_NOT_BOUNDエラーをSlackに返信する
- BR-02-06: 対応外ファイルのみの投稿（テキストなし・対応外ファイル種別のみ）は無視する

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| チャンネル紐付けなし | 「このチャンネルに対応する生徒情報がまだ設定されていないようです。管理者に確認してください。」をSlackに返信。CHANNEL_NOT_BOUNDをエラーログに記録 |
| チャンネル紐付けinactive | 上記と同じ |

## 受入基準（AC）

### AC-02-01: チャンネル直下・メンションあり → 反応する
```gherkin
Given チャンネルが有効な紐付けを持つ
And スレッドなし（チャンネル直下の投稿）
When BotメンションIDを含むメッセージが投稿される
Then process_slack_messageジョブが登録される
```

### AC-02-02: チャンネル直下・メンションなし → 無視
```gherkin
Given チャンネルが有効な紐付けを持つ
And スレッドなし（チャンネル直下の投稿）
When Botメンションを含まないメッセージが投稿される
Then ジョブは登録されない
And Slackへの返信もない
```

### AC-02-03: 登録済みスレッド内 → メンションなしでも反応
```gherkin
Given thread_ts "1234567890.123456" がslack_thread_sessionsに登録済み
When そのスレッド内にメンションなしのメッセージが投稿される
Then process_slack_messageジョブが登録される
```

### AC-02-04: 未登録スレッド内・メンションなし → 無視
```gherkin
Given thread_ts がslack_thread_sessionsに未登録
When そのスレッド内にメンションなしのメッセージが投稿される
Then ジョブは登録されない
```

### AC-02-05: Bot自身のメッセージ → 無視
```gherkin
Given bot_idが付与されたメッセージイベント
When イベントが届く
Then ジョブは登録されない
```

### AC-02-06: 紐付けなしチャンネル → エラー返信
```gherkin
Given slack_channel_bindings に存在しないチャンネルID
When そのチャンネルでBotメンションで投稿される
Then 「このチャンネルに対応する生徒情報がまだ設定されていないようです。管理者に確認してください。」をSlackに返信
And CHANNEL_NOT_BOUNDをai_error_logsに記録
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: `src/features/slack-events/lib/shouldReact.ts`, `src/features/slack-events/lib/eventFacts.ts`, `src/app/api/slack/events/route.ts`
- テストファイル: `shouldReact.test.ts`, `eventFacts.test.ts`, `route.test.ts`
- 最終確認Sprint: Sprint 1
- 備考: CHANNEL_NOT_BOUND 文言は `07_エラー文言設計.md`（確定版）に準拠（本FRの旧文言ではない）
