---
id: FR-01
title: Slackイベント受信・署名検証
priority: P0
status: defined
related_users: []
related_screens: []
version: 1
---

# FR-01: Slackイベント受信・署名検証

## 概要

Slack Events APIからのWebhookを受け取り、署名検証・重複チェック・初期フィルタを行い、対象イベントであればジョブキューに登録してSlackへ即座にACKを返す。

## アクター

- システム（Slack Events APIからのWebhookを受信）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| x-slack-signature | HTTPヘッダー | ○ | `v0=` プレフィックス | HMAC-SHA256署名 |
| x-slack-request-timestamp | HTTPヘッダー | ○ | Unix timestamp | 5分以上古いものは拒否 |
| body (raw) | string | ○ | JSON | 署名検証にはraw bodyが必要 |
| body.type | string | ○ | `url_verification` or `event_callback` | - |
| body.event_id | string | ○ | - | 重複チェック用 |
| body.event.type | string | △ | `message` | event_callbackのみ存在 |
| body.event.channel | string | △ | - | チャンネルID |

## 出力 / 結果

- 正常系（url_verification）: `{"challenge": "<challenge_value>"}` を返す
- 正常系（event_callback対象）: `{"ok": true}` を200で返す + jobsテーブルにジョブ登録
- 異常系: 適切なHTTPステータスを返す（ただしSlackへのユーザー通知は不要）

## ビジネスルール

- BR-01-01: x-slack-signatureの検証に失敗した場合、処理を中断し401を返す
- BR-01-02: x-slack-request-timestampが現在時刻から300秒（5分）以上ずれている場合、リプレイ攻撃防止のため拒否する
- BR-01-03: event_idがslack_event_receiptsテーブルに既存の場合、200を返して処理終了（重複処理しない）
- BR-01-04: ACKはSlack Events APIのタイムアウト（3秒）以内に返す。AI処理をACK前に行ってはならない
- BR-01-05: url_verificationリクエストはchallengeをそのまま返す
- BR-01-06: 対象イベントを受信してジョブ登録が完了したら、受信メッセージに 🤔 リアクションを追加する（`reactions.add` API）。AI処理中であることを生徒に視覚的に示す。リアクション追加失敗はサイレント無視（AI処理を妨げない）

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| 署名検証失敗 | 401を返す。エラーログ: SLACK_SIGNATURE_INVALID |
| タイムスタンプが5分超過 | 401を返す。エラーログ: SLACK_SIGNATURE_INVALID |
| event_id重複 | 200を返す。エラーログ: SLACK_EVENT_DUPLICATE（severity: info） |
| 対象外イベントタイプ | 200を返す。処理終了（ログなし）|
| jobsテーブル登録失敗 | 500を返す。エラーログ: UNKNOWN_ERROR |

## 受入基準（AC）

### AC-01-01: url_verification対応
```gherkin
Given Slackがエンドポイント検証リクエストを送信する
When type="url_verification" のリクエストが届く
Then body.challenge をそのまま返す
And HTTPステータス 200
```

### AC-01-02: 署名検証成功
```gherkin
Given 有効なSlack署名を持つevent_callbackリクエスト
When POST /api/slack/events に届く
Then 署名検証が成功する
And event_idがslack_event_receiptsに記録される
And jobsテーブルにジョブが登録される
And {"ok": true} を200で返す
And 3秒以内にレスポンスする
```

### AC-01-03: 署名検証失敗
```gherkin
Given 無効な署名 または 改ざんされたbody
When POST /api/slack/events に届く
Then 401を返す
And ジョブは登録されない
And ai_error_logsにSLACK_SIGNATURE_INVALIDが記録される
```

### AC-01-04: 重複イベント
```gherkin
Given event_id "Ev_XXXXX" が既にslack_event_receiptsに存在する
When 同じevent_idのリクエストが届く
Then 200を返す
And 新たなジョブは登録されない
```

### AC-01-05: タイムスタンプ古すぎ
```gherkin
Given x-slack-request-timestamp が現在時刻より 301秒 以上古い
When リクエストが届く
Then 401を返す
And ジョブは登録されない
```

### AC-01-06: 考え中リアクション追加
```gherkin
Given 有効なSlackイベントを受信してジョブ登録が完了した
When waitUntil() でバックグラウンド処理が開始される
Then 受信メッセージに 🤔 リアクションが追加される
And リアクション追加が失敗してもAI処理は継続される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: `src/app/api/slack/events/route.ts`, `src/features/slack-events/lib/verifySignature.ts`, `src/features/slack-events/lib/eventReceipts.ts`
- テストファイル: `verifySignature.test.ts`, `eventReceipts.test.ts`, `route.test.ts`
- 最終確認Sprint: Sprint 1
- 備考: 署名検証失敗は DB でなく console.warn に記録（未認証リクエストによる書き込み増幅防止）。🤔 リアクションは processJob 内で付与/削除（AC-01-06）
