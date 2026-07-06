---
id: FR-15
title: チャンネル紐付け管理（管理画面）
priority: P0
status: defined
related_users: [U-03]
related_screens: [SCR-05, SCR-06]
version: 1
---

# FR-15: チャンネル紐付け管理（管理画面）

## 概要

管理画面からSlackチャンネルと生徒の紐付けを作成・編集・有効/無効切り替えする。Bot稼働状況と最終イベント日時を確認できる。

## アクター

- U-03 管理者（全操作）

## 一覧表示項目

| 項目 | 説明 |
|------|------|
| slack_channel_id | チャンネルID（主キー） |
| slack_channel_name | 表示用のみ |
| slack_team_id | ワークスペースID |
| 生徒名（person_name） | スナップショット |
| デフォルトレポート | report_id（タイトルで表示） |
| ステータス | active / inactive |
| 最終イベント日時 | slack_event_receiptsの最新received_at |
| Bot稼働状態 | active/inactive（紐付けステータスと連動） |

## ビジネスルール

- BR-15-01: チャンネルIDは変更不可。channel_nameは任意で更新可能（表示用）
- BR-15-02: 紐付けを無効化するとBot反応も停止する（FR-02 BR-02-05参照）
- BR-15-03: 1チャンネルにつき1生徒のみ（重複チャンネルIDは登録不可）

## 受入基準（AC）

### AC-15-01: 新規紐付け作成
```gherkin
Given 管理者がチャンネルID "C12345"と生徒Aを紐付ける
When 保存する
Then slack_channel_bindingsにレコードが作成される
And status=active
```

### AC-15-02: 紐付けの無効化
```gherkin
Given 紐付けがstatus=activeで存在する
When 管理者がinactiveに変更する
Then そのチャンネルでのBotの反応が停止する
```

### AC-15-03: 重複チャンネルIDの拒否
```gherkin
Given チャンネルID "C12345"の紐付けがすでに存在する
When 同じチャンネルIDで別の生徒への紐付けを作成しようとする
Then エラー「このチャンネルはすでに紐付けされています」が表示される
```

## 実装ステータス（Phase 4 が更新）

- 実装ファイル: `src/features/channel-bindings/{schemas/bindingSchema,lib/getBindings,actions/bindingActions,components/BindingForm}.ts(x)`, `src/app/admin/channels/{page,new/page}.tsx`
- テストファイル: `bindingSchema.test.ts`（+ 既存 lookupBinding.test.ts）
- 最終確認Sprint: Sprint 5
- 備考: 作成/更新 Server Action は requireStaff で認証必須。重複チャンネルは 23505 検知（AC-15-03）。更新は name/status のみ=channel_id 変更不可（BR-15-01）。UI の E2E は要ライブ環境（保留TODO）
