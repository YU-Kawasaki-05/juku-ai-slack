---
id: FR-07
title: チャンネル・生徒紐付け
priority: P0
status: defined
related_users: [U-03]
related_screens: [SCR-05, SCR-06]
version: 1
---

# FR-07: チャンネル・生徒紐付け

## 概要

Slackチャンネルと生徒（person_id）の対応関係を管理する。Botがメッセージを受信した際に、チャンネルIDから生徒を特定するための基盤データを提供する。

## アクター

- U-03 管理者（管理画面で紐付けを作成・編集・無効化する）
- システム（メッセージ受信時にチャンネルIDで紐付けを検索する）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| slack_team_id | string | ○ | - | SlackワークスペースID |
| slack_channel_id | string | ○ | - | 真のキー。channel_nameは参照用 |
| slack_channel_name | string | ○ | - | 表示用のみ（変更されても機能に影響なし） |
| person_id | string | ○ | UUID / persons.idへの外部キー | - |
| default_report_id | string | △ | UUID / reports.idへの外部キー | 省略可。後からでも設定可能 |
| status | string | ○ | `active` or `inactive` | デフォルト: `active` |

## 出力 / 結果

- 正常系（検索）: person_id / report_id を返す
- 正常系（登録）: 紐付けレコードを作成する
- 異常系: CHANNEL_NOT_BOUND（紐付けなし）/ PERSON_NOT_FOUND

## ビジネスルール

- BR-07-01: slack_channel_idを検索の主キーとする。channel_nameのみでの検索・判定は禁止
- BR-07-02: 1チャンネルは1生徒にのみ紐付けられる（1:1対応）
- BR-07-03: status=`inactive`の紐付けは「紐付けなし」と同等に扱う（CHANNEL_NOT_BOUND）
- BR-07-04: channel_nameが変更された場合でも、slack_channel_idが同じなら機能は継続する
- BR-07-05: 同一person_idに複数チャンネルを紐付けることは可能とする（例: 科目別チャンネル）[仮決定]

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| slack_channel_idが紐付けなし | CHANNEL_NOT_BOUND。Slackにエラー返信 |
| 紐付けinactive | CHANNEL_NOT_BOUND。Slackにエラー返信 |
| person_idが存在しない | PERSON_NOT_FOUND（通常は管理画面のバリデーションで防ぐ） |

## 受入基準（AC）

### AC-07-01: チャンネルIDでの紐付け検索
```gherkin
Given slack_channel_id "C12345"がperson_id "uuid-A"に紐付けられている
When チャンネルID "C12345"で紐付けを検索する
Then person_id "uuid-A"が返される
```

### AC-07-02: channel_name変更後も動作継続
```gherkin
Given チャンネル "study-room-taro" (channel_id: C12345)が紐付けられている
When Slack上でチャンネル名が "taro-channel" に変更された
Then channel_id "C12345"での検索は引き続き動作する
```

### AC-07-03: inactive紐付けはCHANNEL_NOT_BOUNDとして扱う
```gherkin
Given slack_channel_id "C12345"の紐付けのstatus=inactive
When チャンネルID "C12345"で紐付けを検索する
Then CHANNEL_NOT_BOUNDエラーが返される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
