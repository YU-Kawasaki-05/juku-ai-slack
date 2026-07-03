---
id: FR-14
title: 生徒管理（管理画面）
priority: P0
status: defined
related_users: [U-02, U-03]
related_screens: [SCR-03, SCR-04]
version: 2
---

# FR-14: 生徒管理（管理画面）

## 概要

管理画面から生徒の一覧・詳細・登録・編集を行う。
SCR-03（一覧）→ SCR-04（詳細）のナビゲーション構造を持つ。
生徒詳細ページは保護者メール・試験期間・利用推移グラフを含む。

## アクター

- U-02 スタッフ（閲覧・編集）
- U-03 管理者（全操作）

---

## SCR-03: 生徒一覧

| 表示項目 | 説明 |
|---------|------|
| 生徒名 | クリックで SCR-04 へ遷移 |
| 学年 | 自由記述 |
| ステータス | active / inactive バッジ |
| 最終利用日時 | `ai_usage_logs` の最新 created_at |
| 今月の質問数 | 当月の ai_usage_logs 件数 |
| 試験期間中 | `exam_mode_until` が未来日ならバッジ表示 |
| 最新レポートの状態 | ai_draft / approved / sent |

---

## SCR-04: 生徒詳細ページ（セクション構成）

### ① 基本情報
- name, display_name, grade, status

### ② 保護者情報
- `guardian_email`（任意）
- 登録されている場合、月次レポート送信時に自動でメール通知される

### ③ 生徒プロフィール（AI参照用）
- summary, learning_style, strengths, weaknesses, instruction_notes

### ④ 試験期間設定
- `exam_mode_until`（試験終了日）
- `exam_subjects`（対象科目リスト）
- 期間中はBotの回答トーンが「要点重視・スピード優先」に切り替わる

### ⑤ 利用推移グラフ
- 過去6ヶ月の月次推移をバーチャート or ラインチャートで表示
- 表示指標（切替可）:
  - 質問数/月
  - AIが答えられなかった率（= ai_error_logs / 全ジョブ）
  - トークン使用量/月

### ⑥ 月次レポート一覧
- 当生徒の全レポートをステータス付き一覧表示
- 各レポートへの直リンク

---

## 試験前モードの挙動

```
スタッフが SCR-04 で exam_mode_until=2026-07-15, exam_subjects=["数学","英語"] を設定
    ↓
Bot（FR-05）が質問受信時に exam_mode_until を確認
    ↓ 試験期間中なら
プロンプトに「試験まであと{N}日。要点を簡潔に答える。暗記ポイントを強調する。」を追加
```

---

## 保護者メール通知の挙動

```
FR-08 でレポートが sent に更新される
    ↓
reports.person_id → persons.guardian_email を確認
    ↓ 登録されていれば
メール送信:
  件名: 「{name}さんの{month}月次学習サマリー」
  本文: 質問数・よく学んだ科目・先生からのひとこと（レポートの要約版）
  送信サービス: Resend（DEC-16）
```

---

## ビジネスルール

- BR-14-01: ステータスをinactiveにしても既存のチャンネル紐付けは削除しない
- BR-14-02: 生徒の削除はMVPスコープ外。inactiveで無効化する
- BR-14-03: guardian_emailは任意。未登録でも月次レポートのSlack送信は正常に行う
- BR-14-04: 試験期間（exam_mode_until）を過ぎたら自動的に通常モードへ戻る（コード側で判定）
- BR-14-05: 利用推移グラフのデータは ai_usage_logs / ai_error_logs の集計で生成する

## 受入基準（AC）

### AC-14-01: 生徒一覧表示
```gherkin
Given 生徒が3人登録されている
When 生徒一覧ページにアクセスする
Then 3人分の生徒が一覧表示される
And 各生徒の今月の質問数・最終利用日時が表示される
And 試験期間中の生徒にはバッジが表示される
```

### AC-14-02: 生徒登録・編集
```gherkin
Given 管理者が新規生徒のフォームを入力する
When name・status・guardian_email（任意）を入力して保存する
Then personsテーブルにレコードが作成される
```

### AC-14-03: 試験期間設定
```gherkin
Given スタッフが生徒Aの詳細ページで exam_mode_until=2026-07-15 を設定する
When 2026-07-14 に生徒AがBotに質問する
Then Botの返答が「試験まであと1日」を含む要点重視の回答になる

When 2026-07-16 に生徒AがBotに質問する
Then Botの返答が通常モードに戻っている
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: -
