---
id: FR-11
title: エラー分類・ログ
priority: P0
status: defined
related_users: []
related_screens: [SCR-11, SCR-12]
version: 1
---

# FR-11: エラー分類・ログ

## 概要

システム内で発生したエラーをエラーコードで分類し、ユーザー向けの文言とシステム内部の詳細ログを分けて保存する。ユーザーには内部エラーを一切見せない。

## アクター

- システム（エラー発生時に自動記録）
- U-02, U-03（管理画面でエラー一覧を確認・対応済みマーク）

## エラーコード一覧

| エラーコード | 概要 | Severity | ユーザー向け文言 |
|------------|------|---------|----------------|
| CHANNEL_NOT_BOUND | チャンネル紐付けなし | warning | 「このチャンネルに対応する生徒情報がまだ設定されていないようです。管理者に確認してください。」 |
| PERSON_NOT_FOUND | 生徒情報なし | error | 「対応する生徒情報が見つかりませんでした。管理者に確認してください。」 |
| REPORT_NOT_FOUND | レポートなし | info | （ユーザー通知なし。プロフィール要約のみで回答継続）|
| REPORT_CHUNK_SEARCH_FAILED | RAG検索エラー | error | （ユーザー通知なし。チャンクなしで回答継続）|
| SLACK_SIGNATURE_INVALID | 署名検証失敗 | error | （Slackへ返信なし。401を返すのみ） |
| SLACK_EVENT_DUPLICATE | イベント重複 | info | （ユーザー通知なし。200を返すのみ）|
| SLACK_FILE_DOWNLOAD_FAILED | 画像DL失敗 | error | 「添付画像の取得に失敗しました。少し時間を置いて再送するか、別の画像で試してください。」 |
| UNSUPPORTED_FILE_TYPE | 対応外ファイル形式 | warning | 「このファイル形式にはまだ対応していません。画像の場合は jpg / png 形式で送ってください。」 |
| IMAGE_TOO_LARGE | 画像サイズ超過 | warning | 「画像ファイルが大きすぎます。圧縮して再送してください。」 |
| IMAGE_PROCESSING_FAILED | 画像処理失敗 | error | 「画像の処理に失敗しました。テキストのみで回答します。」 |
| AI_RATE_LIMITED | AIレートリミット | error | 「ただいまAIの利用が混み合っています。少し時間を置いてもう一度質問してください。」 |
| AI_TIMEOUT | AIタイムアウト | error | 「回答生成に時間がかかりすぎたため、途中で停止しました。質問を少し短くしてもう一度送ってください。」 |
| AI_RESPONSE_FAILED | AI回答生成失敗 | error | 「すみません、処理中に問題が発生しました。管理者が確認できるように記録しました。」 |
| TOKEN_BUDGET_EXCEEDED | トークン上限超過 | warning | 「質問が長すぎます。短くして再送してください。」 |
| SLACK_POST_FAILED | Slack返信失敗 | error | （返信できないため通知不可。ログのみ） |
| JOB_TIMEOUT | ジョブタイムアウト | error | 「処理がタイムアウトしました。もう一度お試しください。」 |
| UNKNOWN_ERROR | その他 | error | 「すみません、処理中に問題が発生しました。管理者が確認できるように記録しました。」 |

## ビジネスルール

- BR-11-01: ユーザーに内部エラー・スタックトレース・APIキーを返してはならない
- BR-11-02: すべてのエラーはエラーコードで分類してai_error_logsに保存する
- BR-11-03: ai_error_logsのraw_errorカラムには内部詳細を保存してよいが、管理画面表示時はマスキングする（MVP後回し）
- BR-11-04: severity=infoのエラーはSlackへの返信を行わない
- BR-11-05: retryable=trueのエラーは将来的にリトライUIで再実行できるようにする（MVP後回し）

## 受入基準（AC）

### AC-11-01: エラーログ保存
```gherkin
Given AI_RATE_LIMITEDエラーが発生した
When エラーハンドラが実行される
Then ai_error_logsにerror_code=AI_RATE_LIMITEDのレコードが作成される
And user_facing_message、internal_message、raw_errorが保存される
And Slackに「ただいまAIの利用が混み合っています〜」が返信される
```

### AC-11-02: 内部エラーがユーザーに見えない
```gherkin
Given UNKNOWN_ERRORが発生した
When AI処理で例外がスローされる
Then Slackへの返信は「すみません、処理中に問題が発生しました〜」のみ
And スタックトレースやAPIキーは含まれない
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
