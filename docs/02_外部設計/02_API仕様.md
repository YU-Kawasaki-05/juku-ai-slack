# API 仕様 — juku-ai-slack-bot

## 1. 設計方針

- アーキテクチャ: RESTful API（Next.js App Router `route.ts`）
- ベースURL: `/api`
- Slack Webhook: `/api/slack/events`（公開、Slack署名検証必須）
- 管理画面API: `/api/admin/*`（Supabase Auth JWTで認証必須）
- レスポンス形式: `{"data": ...}` (成功) / `{"error": {"code": ..., "message": ...}}` (失敗)
- 認証: Supabase Auth JWT（Authorization: Bearer {token}）
- タイムゾーン: UTC（ISO 8601）

---

## 2. 共通仕様

### 2.1 認証ヘッダー

```
Authorization: Bearer {supabase_jwt_token}
```

### 2.2 成功レスポンス形式

```json
// 単一オブジェクト
{ "data": { "id": "uuid", ... } }

// 一覧
{
  "data": [...],
  "meta": { "total": 100, "page": 1, "per_page": 20 }
}
```

### 2.3 エラーレスポンス形式

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力値が不正です",
    "details": [{ "field": "email", "message": "メール形式で入力してください" }]
  }
}
```

### 2.4 HTTPステータスコード

| コード | 用途 |
|--------|------|
| 200 | 成功（GET/PATCH） |
| 201 | 作成成功（POST） |
| 400 | バリデーションエラー |
| 401 | 未認証 |
| 403 | 権限不足 |
| 404 | リソースが存在しない |
| 409 | 重複・競合 |
| 500 | サーバーエラー |

---

## 3. エンドポイント詳細

---

### EP-01: POST /api/slack/events
**説明**: Slack Events APIのWebhookエンドポイント
**認証**: 不要（Slack署名検証で代替）
**関連機能**: FR-01, FR-02, FR-04

**リクエストヘッダー**:
```
X-Slack-Signature: v0=xxxx
X-Slack-Request-Timestamp: 1234567890
Content-Type: application/json
```

**リクエストボディ（url_verification）**:
```json
{ "type": "url_verification", "challenge": "xxxx" }
```

**リクエストボディ（event_callback）**:
```json
{
  "type": "event_callback",
  "event_id": "Ev_XXXXX",
  "event": {
    "type": "message",
    "channel": "C12345",
    "user": "U99999",
    "text": "<@U_BOTID> 数学の問題がわかりません",
    "ts": "1234567890.123456",
    "thread_ts": "1234567890.000000"
  }
}
```

**レスポンス (200, url_verification)**:
```json
{ "challenge": "xxxx" }
```

**レスポンス (200, event_callback)**:
```json
{ "ok": true }
```

**エラー**:
| コード | 条件 |
|--------|------|
| 401 | 署名検証失敗 / タイムスタンプ5分超過 |

**副作用**:
- slack_event_receiptsにevent_id記録
- jobsテーブルに `process_slack_message` ジョブ登録（重複でなければ）

---

### EP-02: GET /api/admin/persons
**説明**: 生徒一覧取得
**認証**: 必要
**関連機能**: FR-14

**クエリパラメータ**:
| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| status | string | NO | 'active' / 'inactive' でフィルタ |
| page | integer | NO | デフォルト: 1 |
| per_page | integer | NO | デフォルト: 20、最大: 100 |

**レスポンス (200)**:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "山田太郎",
      "display_name": "太郎くん",
      "grade": "中学3年",
      "status": "active",
      "latest_report_month": "2026-06-01",
      "channel_names": ["study-taro"],
      "last_used_at": "2026-06-14T15:00:00Z",
      "total_questions": 42,
      "total_tokens": 150000
    }
  ],
  "meta": { "total": 3, "page": 1, "per_page": 20 }
}
```

---

### EP-03: POST /api/admin/persons
**説明**: 生徒登録
**認証**: 必要
**関連機能**: FR-14

**リクエスト**:
```json
{
  "name": "山田太郎",
  "display_name": "太郎くん",
  "grade": "中学3年",
  "status": "active"
}
```

| フィールド | 型 | 必須 | バリデーション |
|-----------|-----|------|--------------|
| name | string | ○ | 1〜100文字 |
| display_name | string | NO | 1〜100文字 |
| grade | string | NO | 1〜50文字 |
| status | string | NO | 'active' / 'inactive'、デフォルト: 'active' |

**レスポンス (201)**: 作成されたpersonオブジェクト

---

### EP-04: GET /api/admin/persons/:id
**説明**: 生徒詳細取得
**認証**: 必要
**関連機能**: FR-14, FR-09

**レスポンス (200)**:
```json
{
  "data": {
    "id": "uuid",
    "name": "山田太郎",
    "grade": "中学3年",
    "status": "active",
    "student_profile": {
      "summary": "...",
      "learning_style": "...",
      "strengths": "...",
      "weaknesses": "...",
      "instruction_notes": "..."
    },
    "channel_bindings": [{ "slack_channel_id": "C12345", "slack_channel_name": "study-taro", "status": "active" }],
    "stats": { "total_questions": 42, "total_tokens": 150000, "last_used_at": "..." }
  }
}
```

---

### EP-05: PATCH /api/admin/persons/:id
**説明**: 生徒情報更新
**認証**: 必要
**関連機能**: FR-14

**リクエスト**: EP-03と同様（全フィールド任意）

**レスポンス (200)**: 更新後のpersonオブジェクト

---

### EP-06: PUT /api/admin/persons/:id/profile
**説明**: 生徒プロフィール要約更新（UPSERT）
**認証**: 必要
**関連機能**: FR-09

**リクエスト**:
```json
{
  "summary": "...",
  "learning_style": "例題ベースで説明すると理解しやすい",
  "strengths": "英単語の暗記が得意",
  "weaknesses": "数学の文章題で条件整理が苦手",
  "instruction_notes": "モチベーションが下がりやすいため声かけ重要"
}
```

**レスポンス (200)**: 更新後のstudent_profileオブジェクト

---

### EP-07: GET /api/admin/channel-bindings
**説明**: チャンネル紐付け一覧
**認証**: 必要
**関連機能**: FR-15

**クエリパラメータ**: status, page, per_page

**レスポンス (200)**:
```json
{
  "data": [
    {
      "id": "uuid",
      "slack_channel_id": "C12345",
      "slack_channel_name": "study-taro",
      "person_id": "uuid",
      "person_name": "山田太郎",
      "status": "active",
      "last_event_at": "2026-06-14T15:00:00Z"
    }
  ]
}
```

---

### EP-08: POST /api/admin/channel-bindings
**説明**: チャンネル紐付け作成
**認証**: 必要
**関連機能**: FR-15

**リクエスト**:
```json
{
  "slack_team_id": "T01234",
  "slack_channel_id": "C12345",
  "slack_channel_name": "study-taro",
  "person_id": "uuid",
  "default_report_id": "uuid"
}
```

| フィールド | 型 | 必須 | バリデーション |
|-----------|-----|------|--------------|
| slack_team_id | string | ○ | 1〜50文字 |
| slack_channel_id | string | ○ | 1〜50文字、UNIQUE |
| slack_channel_name | string | NO | 〜200文字 |
| person_id | UUID | ○ | persons.idに存在すること |
| default_report_id | UUID | NO | reports.idに存在すること |

**レスポンス (201)**: 作成された紐付けオブジェクト

**エラー**:
| コード | error.code | 条件 |
|--------|-----------|------|
| 409 | DUPLICATE_CHANNEL | slack_channel_idが既存 |
| 404 | PERSON_NOT_FOUND | person_idが存在しない |

---

### EP-09: PATCH /api/admin/channel-bindings/:id
**説明**: チャンネル紐付け更新（channel_name/status/report_id変更）
**認証**: 必要
**関連機能**: FR-15

**リクエスト**: `slack_channel_name`, `status`, `default_report_id` のみ変更可（channel_idは不変）

---

### EP-10: GET /api/admin/reports
**説明**: レポート一覧
**認証**: 必要
**関連機能**: FR-16

**クエリパラメータ**:
| パラメータ | 型 | 説明 |
|-----------|-----|------|
| person_id | UUID | 生徒フィルタ |
| status | string | 'draft' / 'published' |
| page | integer | - |
| per_page | integer | - |

---

### EP-11: POST /api/admin/reports
**説明**: レポート作成
**認証**: 必要
**関連機能**: FR-16, FR-08

**リクエスト**:
```json
{
  "person_id": "uuid",
  "title": "2026年6月 月次レポート",
  "report_month": "2026-06-01",
  "body_markdown": "# 月次学習レポート\n...",
  "status": "draft",
  "is_ai_reference": true
}
```

**エラー**:
| コード | error.code | 条件 |
|--------|-----------|------|
| 409 | DUPLICATE_REPORT_MONTH | 同月レポートが既存 |

---

### EP-12: GET /api/admin/reports/:id
**説明**: レポート詳細
**認証**: 必要

---

### EP-13: PATCH /api/admin/reports/:id
**説明**: レポート更新
**認証**: 必要
**関連機能**: FR-16

**注意**: 更新後に `embeddings_updated_at` と `body_markdown` の更新日時を比較し、再生成が必要かを返す。

**レスポンス (200)**:
```json
{
  "data": { ...report },
  "warnings": ["embedding_rebuild_required"]
}
```

---

### EP-14: POST /api/admin/reports/:id/rebuild-embeddings
**説明**: Embedding再生成
**認証**: 必要（[仮決定] 管理者のみ）
**関連機能**: FR-10, FR-16

**レスポンス (200)**:
```json
{
  "data": {
    "deleted_chunks": 8,
    "created_chunks": 10,
    "embeddings_updated_at": "2026-06-15T10:00:00Z"
  }
}
```

---

### EP-15: GET /api/admin/usage
**説明**: 利用状況集計取得
**認証**: 必要
**関連機能**: FR-18

**クエリパラメータ**:
| パラメータ | 型 | 説明 |
|-----------|-----|------|
| from | date | 開始日（ISO 8601） |
| to | date | 終了日 |
| group_by | string | 'day' / 'person' / 'model' |

**レスポンス (200)**:
```json
{
  "data": {
    "summary": {
      "total_questions": 350,
      "total_input_tokens": 1200000,
      "total_output_tokens": 450000,
      "total_tokens": 1650000,
      "estimated_cost_usd": 4.95,
      "error_count": 5,
      "image_questions": 80
    },
    "breakdown": [...]
  }
}
```

---

### EP-16: GET /api/admin/errors
**説明**: エラー一覧取得
**認証**: 必要
**関連機能**: FR-17

**クエリパラメータ**: `error_code`, `severity`, `resolved`, `from`, `to`, `page`, `per_page`

---

### EP-17: PATCH /api/admin/errors/:id
**説明**: エラー対応済みマーク・メモ更新
**認証**: 必要
**関連機能**: FR-17

**リクエスト**:
```json
{ "resolved": true, "notes": "Slackの一時障害。再発なし" }
```

---

### EP-18: GET /api/admin/threads
**説明**: 会話ログ一覧取得
**認証**: 必要
**関連機能**: FR-19

**クエリパラメータ**: `person_id`, `slack_channel_id`, `from`, `to`, `has_error`, `page`, `per_page`

---

## 4. クイックリファレンス

| EP-ID | メソッド | パス | 関連機能 | 認証 |
|-------|---------|------|---------|------|
| EP-01 | POST | /api/slack/events | FR-01, FR-02, FR-04 | Slack署名 |
| EP-02 | GET | /api/admin/persons | FR-14 | Bearer |
| EP-03 | POST | /api/admin/persons | FR-14 | Bearer |
| EP-04 | GET | /api/admin/persons/:id | FR-14, FR-09 | Bearer |
| EP-05 | PATCH | /api/admin/persons/:id | FR-14 | Bearer |
| EP-06 | PUT | /api/admin/persons/:id/profile | FR-09 | Bearer |
| EP-07 | GET | /api/admin/channel-bindings | FR-15 | Bearer |
| EP-08 | POST | /api/admin/channel-bindings | FR-15 | Bearer |
| EP-09 | PATCH | /api/admin/channel-bindings/:id | FR-15 | Bearer |
| EP-10 | GET | /api/admin/reports | FR-16 | Bearer |
| EP-11 | POST | /api/admin/reports | FR-16, FR-08 | Bearer |
| EP-12 | GET | /api/admin/reports/:id | FR-16 | Bearer |
| EP-13 | PATCH | /api/admin/reports/:id | FR-16 | Bearer |
| EP-14 | POST | /api/admin/reports/:id/rebuild-embeddings | FR-10, FR-16 | Bearer |
| EP-15 | GET | /api/admin/usage | FR-18 | Bearer |
| EP-16 | GET | /api/admin/errors | FR-17 | Bearer |
| EP-17 | PATCH | /api/admin/errors/:id | FR-17 | Bearer |
| EP-18 | GET | /api/admin/threads | FR-19 | Bearer |
