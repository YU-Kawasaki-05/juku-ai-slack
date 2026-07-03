---
id: FR-04
title: 非同期ジョブ処理
priority: P0
status: defined
related_users: []
related_screens: []
version: 1
---

# FR-04: 非同期ジョブ処理

## 概要

Slack Events APIのACK（即時応答）とAI処理を分離するための非同期ジョブ基盤。イベント受信時にジョブをキューに登録し、別プロセス（worker）がジョブを取り出して処理する。処理失敗時はリトライを行う。

## アクター

- システム（FR-01がジョブを登録、workerが処理）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| job_type | string | ○ | `process_slack_message` | MVPでは1種類 |
| payload | JSON | ○ | - | Slackイベントの必要情報を含む |
| max_attempts | integer | ○ | 1以上5以下 | デフォルト: 3 |

## 出力 / 結果

- 正常系: ジョブがjobsテーブルに`pending`ステータスで登録される
- 処理完了: ジョブステータスが`completed`に更新される
- 処理失敗: ジョブステータスが`failed`に更新される（max_attempts到達時）

## ビジネスルール

- BR-04-01: ジョブ登録はACK返却前に完了させる（ACKのタイムアウト3秒以内）
- BR-04-02: Slack Webhook ハンドラは即座に ACK を返した後、`waitUntil()` でバックグラウンドジョブ処理を開始する（DEC-13）
- BR-04-03: 処理中のジョブはstatus=`processing`に更新し、二重処理を防ぐ
- BR-04-04: 処理失敗時はattempt_countをインクリメントし、max_attemptsに達した場合はstatus=`failed`にする
- BR-04-05: ジョブのpayloadにはSlack署名検証後の情報のみ含める（raw bodyは含めない）
- BR-04-06: ジョブ基盤は `waitUntil + jobs テーブル` で実装。Cron は使用しない（DEC-13）。失敗時は `waitUntil` 内でリトライ（最大 max_attempts 回）

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| ジョブ処理中に例外発生 | attempt_countインクリメント。max_attempts未達ならリトライ待機 |
| max_attempts到達 | status=`failed`に更新。ai_error_logsに記録 |
| ジョブが長時間processing状態 | JOB_TIMEOUTとしてfailed扱い（タイムアウト時間は設定可能） |

## 受入基準（AC）

### AC-04-01: ジョブ登録
```gherkin
Given 有効なSlackイベントを受信した
When ACKを返す前にジョブを登録する
Then jobsテーブルにstatus="pending"のレコードが作成される
And ACKは3秒以内に返される
```

### AC-04-02: ジョブ処理完了
```gherkin
Given status="pending"のジョブが存在する
When workerがジョブを取得して処理する
Then status="processing"に更新されてから処理開始
And 処理成功後にstatus="completed"に更新
```

### AC-04-03: ジョブ失敗リトライ
```gherkin
Given max_attempts=3 のジョブが処理中に失敗した
When attempt_count=1
Then status="pending"に戻してリトライ待機
And attempt_count=2

When attempt_count=3で再度失敗
Then status="failed"に更新
And ai_error_logsに記録
```

### AC-04-04: 二重処理防止
```gherkin
Given status="processing"のジョブが存在する
When 別のworkerが同じジョブを取得しようとする
Then 二重取得されない（行ロックまたは楽観的ロックで防ぐ）
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
