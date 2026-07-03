---
id: FR-08
title: レポート管理（データ層）
priority: P0
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-07, SCR-08, SCR-09]
version: 2
---

# FR-08: レポート管理（データ層）

## 概要

月次学習レポートをAIが自動生成し、スタッフが確認・承認後に生徒のSlackチャンネルへ送信する。
レポートはRAGの参照ソースとしても機能する。（DEC-16）

## アクター

- システム（月末Cronでレポートを自動生成）
- U-02 スタッフ（レポートの確認・承認・送信）
- U-03 管理者（全操作 + 手動生成）

## ステータスフロー

```
[Cron実行]
    ↓
ai_draft（AI生成完了・スタッフ確認待ち）
    ↓ スタッフが確認・必要なら編集
approved（承認済み・送信待ち）
    ↓ スタッフが「送信」ボタン
sent（Slackへ送信済み）

※ スタッフが手動で下書きを作る場合は draft → approved → sent
```

| status | 意味 | AI参照対象 |
|--------|------|-----------|
| `ai_draft` | AI生成済み・スタッフ確認待ち | ❌ |
| `draft` | スタッフ手動作成中 | ❌ |
| `approved` | スタッフ承認済み・送信前 | ✅ |
| `sent` | Slackへ送信済み | ✅ |

## AI自動生成の仕組み

- **実行タイミング**: 月末7日間（24〜31日）の毎日23:55 JST（Vercel Cron）
- **入力**: 当月の `slack_messages`（ユーザー発言のみ）+ 統計情報（質問数・利用日数等）
- **出力**: Slack mrkdwn 形式のMarkdown（`#` 見出しを使わない）
- **分割処理**: 1回のCronで3名ずつ処理（Vercelタイムアウト対策）
- **通知**: 全員分の生成完了後、Slack #alerts へ通知（DEC-16）

## AI生成レポートのSlack送信フォーマット

**チャンネル投稿（ヘッダー）:**
```
【@{display_name}さん_{YYYY}年{M}月_月次レポート】
```

**スレッド返信（本文）:**
```
{month}もよく頑張りました！今月の学習をまとめました :memo:

*📊 今月の活動*
質問数: {count}件　利用日数: {active_days}日

*📚 よく学んだこと*
・{topic1}
・{topic2}

*💬 今月の様子*
{ai_assessment}

*🎯 来月のアドバイス*
{ai_advice}

わからないことはこのスレッドでいつでも聞いてね :raised_hands:
```

## 入力データ（手動作成時）

| フィールド | 型 | 必須 | 制約 | 備考 |
|-----------|----|----|------|------|
| person_id | UUID | ○ | - | 対象生徒 |
| title | string | ○ | 1〜200文字 | 例: 「2026年5月 月次レポート」 |
| report_month | date | ○ | YYYY-MM-01 形式（月初） | 重複チェック対象 |
| body_markdown | string | ○ | Slack mrkdwn形式 | `#`見出し不使用 |
| is_ai_reference | boolean | ○ | - | デフォルト: true |

## ビジネスルール

- BR-08-01: 同一person_idで同一report_monthのレポートは1件のみ作成できる
- BR-08-02: `ai_draft` / `draft` のレポートはAI参照対象にしない
- BR-08-03: `is_ai_reference=false` のレポートはRAGチャンク検索の対象外にする
- BR-08-04: レポート保存時（ai_draft除く）にEmbeddingを自動再生成する（DEC-14）
- BR-08-05: レポートを削除する場合は関連するreport_chunksも削除する
- BR-08-06: Slack送信後は `reports.slack_message_ts` に送信メッセージのtsを保存する
- BR-08-07: AI生成レポートは `generated_by_ai=true` で記録する
- BR-08-08: 承認待ちレポートが発生したらSlack #alerts へ通知する（DEC-16）
- BR-08-09: 管理画面のレポート一覧は生徒名を最優先表示とし、複数スタッフが並行確認しやすくする（DEC-16）

## エラーケース

| 条件 | 期待挙動 |
|------|---------|
| 同一person_id + report_monthの重複 | エラー: 「同じ月のレポートがすでに存在します」 |
| REPORT_NOT_FOUND | RAGチャンク検索をスキップ（生徒プロフィール要約のみで回答）|
| AI生成失敗 | status=`ai_draft`・error_message記録・#alertsへ通知 |
| Slack送信失敗 | status=`approved`のまま維持・管理画面で再送可能 |

## 受入基準（AC）

### AC-08-01: AI自動生成
```gherkin
Given 月末Cronが実行された
When 当月にSlackメッセージがある生徒Aが存在する
Then reports テーブルに status=ai_draft のレコードが作成される
And generated_by_ai=true で記録される
And Slack #alerts に「N件のレポートが生成されました」と通知される
```

### AC-08-02: スタッフ承認・送信
```gherkin
Given status=ai_draft のレポートが存在する
When スタッフが管理画面で確認して「承認・送信」ボタンを押す
Then レポートが生徒のSlackチャンネルへ送信される
And チャンネルに「【@{name}さん_{month}_月次レポート】」が投稿される
And そのスレッドにレポート本文が返信される
And status が sent に更新される
And reports.slack_message_ts が保存される
```

### AC-08-03: 同月重複エラー
```gherkin
Given 生徒Aの2026年6月のレポートがすでに存在する
When 同じ生徒・同じ月のレポートを作成しようとする
Then エラー「同じ月のレポートがすでに存在します」が表示される
```

### AC-08-04: ai_draft はAI参照対象外
```gherkin
Given status=ai_draft のレポートが存在する
When AI処理でRAGチャンク検索が実行される
Then ai_draft レポートのチャンクは検索結果に含まれない
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
