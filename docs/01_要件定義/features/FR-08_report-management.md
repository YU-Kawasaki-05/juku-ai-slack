---
id: FR-08
title: レポート管理（データ層）
priority: P0
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-07, SCR-08, SCR-09]
version: 3
---

# FR-08: レポート管理（データ層）

## 概要

月次学習レポートをAIが自動生成し、スタッフが確認・承認後に生徒のSlackチャンネルへ送信する。
レポートはRAGの参照ソースとしても機能する。（DEC-16）

## アクター

- システム（月初の Cron で前月分のレポートを自動生成。下記「AI自動生成の仕組み」）
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

> 2026-10 に実装した内容（当初設計の「月末7日間 23:55 JST・3名ずつ・#alerts 通知」から変更）。
> 変更点: 実行は**月初**（前月分を作る）、出力は Slack mrkdwn ではなく**通常の Markdown（`##` 見出し）**、
> 通知は #alerts ではなく**メール**（失敗時のみ #alerts）。生徒への Slack 送信（下記フォーマット）は未実装のまま。

- **実行タイミング**: 毎月 1〜3 日の 0:00 UTC（日本時間 9:00）に Vercel Cron が `GET /api/cron/monthly-reports` を呼ぶ（`vercel.json`）。対象は日本時間の**前月**。認証は `Authorization: Bearer <CRON_SECRET>`（無い・違う・未設定は 401）
- **2・3 日目**: 1 日目に時間切れで残った分の続きと、未送信のメール送信だけを行う（作り終えて送信済みなら何もしない）。3 日目は未作成が残っていても作成済み分をメールする
- **入力**: 対象月（日本時間の月初〜翌月初）の `slack_messages`（生徒の質問と AI の回答。`person_id` で絞る）。質問数・利用日数はコードで数えた値を LLM に渡す。生徒の氏名は渡さない
- **対象**: 有効（active）な生徒のうち前月に質問が 1 件以上あるもの。**質問 0 件の生徒のレポートは作らない**
- **出力**: Markdown。見出しは「今月の質問の数と主な単元 / よく分かっていたこと / つまずいていたこと / 来月に向けたおすすめ / スタッフへのメモ」。会話に無いことを書かない・根拠が足りないことは「判断できない」と書く、と指示する
- **保存**: `reports` に `status='ai_draft'`・`generated_by_ai=true`・タイトル `YYYY年M月 学習レポート`（氏名なし）。保存後に Embedding を生成する（下記）
- **分割処理**: 1 回の実行で **30 名・150 秒・同時 3 名**まで（`MONTHLY_REPORT_*`）。上限に達したら新しい生徒に着手せず止まる。`generated_by_ai=true` の前月分がある生徒は飛ばす（再開）。**スタッフが手で書いた前月分（`generated_by_ai=false`）は上書きせず飛ばす**。1 人の失敗は他の生徒を止めず、`ai_error_logs`（`MONTHLY_REPORT_FAILED`）に記録して次の実行で再試行する
- **kill_switch**: AI 応答が緊急停止中は LLM を呼ばない（作成を見送り、次の実行で再開）
- **メール送付**: 全員分が揃ったら 1 通のメールに生徒ごとの `YYYY-MM_<表示名>.md` を添付して送る（Resend の HTTP API）。本文は生徒ごとの質問数の一覧（0 件は「質問なし」、手書きがあれば「添付なし」）と管理画面への案内。宛先は `REPORT_EMAIL_TO`（カンマ区切り）、送信元は `RESEND_FROM_EMAIL`
- **二重送信防止**: `monthly_report_runs`（migration 033）の `emailed_at`、送る前の条件付き UPDATE による送信権の取得（`email_claimed_at`。cron と手動ボタンが同時に動いても 1 回）、Resend の `Idempotency-Key`（`monthly-report-YYYY-MM`）
- **メール設定なし**: `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `REPORT_EMAIL_TO` のどれかが無いときは作成だけ行い、ログと戻り値に「メール設定なし」を出す（落とさない。設定後の次の実行で送る）
- **送信失敗**: `monthly_report_runs.email_error` に記録し、`SLACK_ALERTS_CHANNEL_ID` へ通知する。次の実行（または手動ボタン）で再試行する
- **手動実行**: レポート一覧の「先月分を今すぐ作成して送る」（admin のみ）が同じ関数を呼ぶ。送信済みの月は再送されない（「送り直し」は無い）
- **Embedding**: `ai_draft` のうちに Embedding を作る。承認時に本文を変えないと再生成が走らず「承認したのに検索できない」状態になるため。`ai_draft` のチャンクは `match_report_chunks`（`approved` / `sent` のみ）に出ないので、承認前に回答へ混ざらない（BR-08-02, AC-08-04）。BR-08-04 の「ai_draft 除く」は、**自動再生成は保存時に行うが検索対象にはしない**と読み替えた
- **最後の試行の通知**: cron の 3 日目に、何も作れなかった（kill_switch 停止・LLM 未設定・全員失敗）月、またはメール設定なしで送れなかった月は、`SLACK_ALERTS_CHANNEL_ID` へ「YYYY-MM の月次レポート: N名未作成／メール未設定」と通知する。送信済みの記録（`emailed_at`）に失敗したときは 1 回リトライし、駄目なら通知する
- **利用量ログ**: `ai_usage_logs.message_ts` は `monthly_report:YYYY-MM-summary`。末尾 `-summary` により、生徒の質問回数（1 時間 10 回）の判定から除外される。ダッシュボードの質問数・コストの集計（`admin_usage_summary` / `admin_usage_analytics`）は派生ログ（`-eval` / `-summary`）を含めて全行を数える既存仕様のため、月次レポートの LLM 呼び出しもコストに含まれ、質問数には 1 生徒 1 件ずつ加算される
- **表示の安全**: 月次レポートは生徒の入力を元に LLM が作るため、管理画面の Markdown 表示（`MarkdownContent`）は画像を表示しない。指示文でもリンクと画像を出さないよう求める
- **ダウンロード**: レポート詳細の「Markdown で保存」（`GET /admin/reports/:id/markdown`。staff 以上）

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

- 実装ファイル（データ層・手動 CRUD）: `src/features/reports/`, `src/app/admin/reports/`（管理画面 CRUD は FR-16 として実装）
- 実装ファイル（月次の自動作成・メール）: `src/features/monthly-reports/`, `src/app/api/cron/monthly-reports/route.ts`, `src/app/admin/reports/[id]/markdown/route.ts`, `supabase/migrations/033_create_monthly_report_runs.sql`, `vercel.json`
- テストファイル: `reportSchema.test.ts`, `reportActions.test.ts`, `src/features/monthly-reports/**/*.test.ts`, 上記 2 つの route.test.ts
- 最終確認Sprint: Sprint 7（部分）→ 月次の自動作成・メールは 2026-10 に追加

### 実装した範囲（2026-10）

- ✅ AC-08-01 AI 月次自動作成（前月分・cron 1〜3 日・分割処理・再開・手書きを上書きしない・`generated_by_ai=true`）。BR-08-07 達成
- ✅ メール送付（1 か月 1 通・生徒ごとの .md 添付・二重送信防止・メール設定なしで落ちない・失敗の記録と #alerts 通知）
- ✅ 管理者の手動実行ボタン、レポート詳細の Markdown ダウンロード

### やっていないこと

- ❌ **AC-08-02 承認後の Slack チャンネル送信**（`slack_message_ts` 保存・送信リトライ）。生徒への配布は引き続き人の手
- ❌ 生徒・保護者へのメール送付（DEC-17）。宛先は `REPORT_EMAIL_TO`（スタッフ）のみ。`persons.guardian_email` は使わない
- ❌ Google Drive への保存、PDF 化
- ❌ 「作成完了」の #alerts 通知（BR-08-08）。通知はメール。#alerts に出るのはメール送信失敗のみ
- ❌ 「送信済みの月を送り直す」操作（メールを送り直したいときは `monthly_report_runs.emailed_at` を手で NULL に戻す）
- status は AC-08-02 未達のため `defined` を維持。
