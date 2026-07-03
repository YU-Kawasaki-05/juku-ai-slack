---
id: FR-17
title: エラー管理（管理画面）
priority: P0
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-11, SCR-12]
version: 1
---

# FR-17: エラー管理（管理画面）

## 概要

システムで発生したエラーを管理画面で一覧表示・詳細確認・対応済みマーク・メモ記入する。

## アクター

- U-02 スタッフ（閲覧・対応済みマーク・メモ）
- U-03 管理者（全操作）

## 一覧表示項目

| 項目 | 説明 |
|------|------|
| エラーコード | CHANNEL_NOT_BOUND等 |
| severity | error / warning / info |
| 発生日時 | created_at |
| 生徒名 | person_id → nameで表示 |
| チャンネル名 | slack_channel_name |
| スレッドURL | Slackのスレッドリンク |
| ユーザーへ返した文言 | user_facing_message |
| 対応済みフラグ | resolved |

## 詳細表示項目

一覧項目に加えて:
- 内部エラー詳細（internal_message）
- retry可能か（retryable）
- メモ欄（管理者が記入）
- raw_error（要マスキング。MVP後回し）

## ビジネスルール

- BR-17-01: raw_errorはMVPでは表示しない（将来的にマスキング処理後に表示）
- BR-17-02: severity=infoのエラーは一覧でデフォルトフィルタアウトする（表示オプション提供）
- BR-17-03: 対応済みフラグは手動でのみ変更可能

## 受入基準（AC）

### AC-17-01: エラー一覧表示
```gherkin
Given ai_error_logsに5件のエラーがある
When エラー一覧ページにアクセスする
Then severity=error/warningのエラーが新しい順に表示される
```

### AC-17-02: 対応済みマーク
```gherkin
Given 未対応のエラーが1件ある
When 管理者が対応済みボタンを押す
Then resolved=trueに更新される
And 一覧表示では区別できる（例：薄くなる）
```

### AC-17-03: メモ記入
```gherkin
Given エラー詳細ページを表示している
When 管理者がメモ欄に「Slackの一時障害。再発なし」と入力して保存する
Then ai_error_logsのメモカラムに保存される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
