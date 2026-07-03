---
id: FR-12
title: usage log
priority: P0
status: defined
related_users: []
related_screens: [SCR-10]
version: 1
---

# FR-12: usage log

## 概要

AI APIを呼び出すたびにトークン数・推定コスト・モデル名・レイテンシを記録する。コスト監視と品質改善のための基礎データとなる。

## アクター

- システム（AI API呼び出し後に自動記録）
- U-02, U-03（管理画面で利用状況を確認）

## 入力データ

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| person_id | UUID | ○ | - | |
| slack_channel_id | string | ○ | - | |
| thread_ts | string | ○ | - | |
| message_ts | string | ○ | - | |
| model | string | ○ | - | 使用したAIモデル名 |
| input_tokens | integer | ○ | 0以上 | |
| output_tokens | integer | ○ | 0以上 | |
| total_tokens | integer | ○ | 0以上 | |
| estimated_cost | numeric | ○ | USD、小数点8桁まで | モデルの単価から計算 |
| has_image | boolean | ○ | - | 画像を含む質問か |
| latency_ms | integer | ○ | 0以上 | AI API呼び出しの応答時間 |

## ビジネスルール

- BR-12-01: AI APIの呼び出しが成功・失敗にかかわらず、可能な範囲でusage logを保存する（エラー時はinput_tokensのみ記録できる場合もある）
- BR-12-02: estimated_costはモデルごとの単価表から計算する。単価表は設定ファイルで管理する
- BR-12-03: ログにAPIキーや個人を特定できる氏名を直接保存しない

## 受入基準（AC）

### AC-12-01: AI API呼び出し後の記録
```gherkin
Given AI APIが正常に回答を返した
When usage logの記録処理が実行される
Then ai_usage_logsに1レコードが追加される
And model / input_tokens / output_tokens / estimated_cost / latency_ms が設定される
```

### AC-12-02: 画像あり質問の記録
```gherkin
Given 画像付き質問のAI処理が完了した
When usage logを記録する
Then has_image=trueで保存される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
