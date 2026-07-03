---
id: FR-06
title: 画像添付処理
priority: P0
status: defined
related_users: [U-01, U-02]
related_screens: []
version: 1
---

# FR-06: 画像添付処理

## 概要

Slackメッセージに添付された画像をBot tokenでダウンロードし、Supabase Storageに保存してattachmentsテーブルにメタデータを記録する。Vision対応AIモデルに渡すためのデータを準備する。

## アクター

- U-01 生徒（画像を添付して質問）
- U-02 スタッフ（画像を添付して質問）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| file.id | string | ○ | - | SlackファイルID |
| file.url_private | string | ○ | - | Slack内部ダウンロードURL（Bot tokenが必要） |
| file.mimetype | string | ○ | `image/jpeg`, `image/png`, `image/webp` | 対応形式のみ |
| file.size | integer | ○ | バイト数 | 上限チェック用 |
| file.name | string | ○ | - | オリジナルファイル名 |

## 出力 / 結果

- 正常系: attachmentsテーブルにメタデータ保存 + Supabase StorageのストレージパスをAI処理に渡す
- 異常系: SLACK_FILE_DOWNLOAD_FAILED / UNSUPPORTED_FILE_TYPE / IMAGE_TOO_LARGE

## ビジネスルール

- BR-06-01: 対応ファイル形式は jpg / jpeg / png / webp のみ。他の形式は UNSUPPORTED_FILE_TYPE エラー
- BR-06-02: 1メッセージあたり最大3枚まで処理する（4枚以上は最初の3枚のみ処理）
- BR-06-03: 1枚あたりのファイルサイズ上限は 20MB（[仮決定]。AIモデルの制限に合わせる）
- BR-06-04: 画像はBot tokenを使ってSlackのurl_privateからダウンロードする
- BR-06-05: ダウンロードした画像はSupabase Storageに保存する。保存先パス: `attachments/{person_id}/{year}/{month}/{slack_file_id}.{ext}`
- BR-06-06: MVPではOCR処理は行わない。Vision modelに直接渡す
- BR-06-07: 将来的なOCRテキスト保存を考慮してattachmentsテーブルにocr_textカラムを持つ（MVPでは空）
- BR-06-08: テキストなしで対応外ファイルのみの場合は UNSUPPORTED_FILE_TYPE として処理しない（FR-02 BR-02-06参照）

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| 対応外ファイル形式 | 「このファイル形式にはまだ対応していません。画像の場合は jpg / png 形式で送ってください。」をSlackに返信 |
| ファイルサイズ超過 | IMAGE_TOO_LARGEエラー。ユーザーには「画像ファイルが大きすぎます。圧縮して再送してください。」 |
| Slackファイルダウンロード失敗 | 「添付画像の取得に失敗しました。少し時間を置いて再送するか、別の画像で試してください。」 |
| Supabase Storage保存失敗 | IMAGE_PROCESSING_FAILEDエラー。処理継続（画像なしでテキストのみ回答）[仮決定] |

## 受入基準（AC）

### AC-06-01: 正常系 png画像の処理
```gherkin
Given 生徒がpng画像1枚を添付してBotに質問した
When 画像処理が実行される
Then Slackからpng画像がダウンロードされる
And Supabase Storageの所定パスに保存される
And attachmentsテーブルにメタデータが記録される
And Vision対応モデルに画像データが渡される
```

### AC-06-02: 対応外ファイル形式
```gherkin
Given 生徒がPDFファイルのみを添付した
When 画像処理が実行される
Then UNSUPPORTED_FILE_TYPEエラーとなる
And 「このファイル形式にはまだ対応していません〜」をSlackに返信
```

### AC-06-03: 4枚以上の添付
```gherkin
Given 生徒が4枚の画像を添付した
When 画像処理が実行される
Then 最初の3枚のみ処理される
And 4枚目は無視される
```

### AC-06-04: 対応形式と対応外が混在
```gherkin
Given 生徒がpng画像1枚とPDF1つを添付した
When 画像処理が実行される
Then png画像のみ処理される
And PDFは無視される（エラーにならない）
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
