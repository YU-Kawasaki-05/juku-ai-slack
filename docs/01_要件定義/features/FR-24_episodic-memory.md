---
id: FR-24
title: エピソード記憶システム（Open Brain / Duolingo Lilyパターン）
priority: P1
status: defined
related_users: [U-01]
related_screens: []
version: 1
---

# FR-24: エピソード記憶システム

## 概要

セッション終了後に非同期でLLMが事実を抽出し、重要度スコア付きで保存する。
次回セッション開始時に重要度の高い記憶をプロンプトにロードし、
「このBotは自分のことを知っている」という体験を作る。（DEC-21）

参考: Duolingo Lily の実運用パターン。外部API依存なし。Supabase完結。

## アクター

- システム（セッション終了後に非同期実行）
- Bot（次回セッション開始時に記憶をプロンプト注入）

---

## セッション終了条件

- 最終メッセージから30分以上経過
- または thread_sessions.status が 'closed' に更新された時

## 事実抽出パイプライン

```
セッション終了検知
    ↓ waitUntil() — 非同期
LLM が会話履歴を解析し、事実リストを抽出
[
  { content: "算数より国語が得意", importance: 8 },
  { content: "昨日の模試で数学が70点だった", importance: 7 },
  { content: "サッカーが好き", importance: 3 },
  ...
]
    ↓
既存記憶と重複チェック（embedding類似度 > 0.92）
    ↓ 更新の場合
old_record.superseded_by = new_record.id で論理上書き（履歴保持）
    ↓ 新規の場合
student_episodic_memories に INSERT + embedding生成
```

## 重要度スコアリング基準

| スコア | 内容の例 | 保持期間 |
|--------|---------|---------|
| 10 | 学習目標・長期的な弱点・科目好嫌い | 永続 |
| 8〜9 | 試験結果・重要なブレイクスルー体験 | 1年 |
| 6〜7 | 最近の学習進捗・スタッフ指示 | 3ヶ月 |
| 3〜5 | 日常雑談・一時的な気分 | 1ヶ月 |
| 1〜2 | 繰り返しの挨拶・定型フレーズ | 1週間 |

## ブートシーケンス（セッション開始時）

```typescript
// 1. 重要度7以上の記憶を全件取得（ベクトル検索なし・高速）
const coreMemories = await db
  .from('student_episodic_memories')
  .select('content')
  .eq('person_id', personId)
  .gte('importance', 7)
  .is('superseded_by', null)
  .order('importance', { ascending: false })
  .limit(20)

// 2. システムプロンプトに注入
const memoryBlock = coreMemories
  .map(m => `・${m.content}`)
  .join('\n')
```

## プロンプト注入フォーマット

```
[この生徒について知っていること]
・算数より国語が得意（importance:8）
・昨日の模試で数学が70点だった（importance:7）
・サッカーが好き（importance:3）
```

importance ≥ 7 のみ毎回注入。3〜6 は特定トピックの質問時にベクトル検索で補完。

## プロンプトキャッシング

- `coreMemories` ブロックをプロンプトキャッシュのターゲットに指定
- Anthropicの `cache_control: {"type": "ephemeral"}` で実装
- キャッシュヒット率: セッション継続中は100%
- 期待コスト削減: 約80%（Anthropic公式計測値）

## 安全設計

- **アプリ層フィルタ禁止**: Mem0方式のuser_idフィルタは採用しない
- **Supabase RLS必須**: `WHERE person_id = auth.uid()` ポリシーをDBレイヤーで強制
- 未成年データのため他生徒への記憶漏洩（context bleeding）を物理的に防止

---

## ビジネスルール

- BR-24-01: 1セッションから抽出できる事実は最大10件まで（プロンプトコスト制御）
- BR-24-02: importance ≥ 7 の記憶がシステムプロンプトに含まれる件数は最大20件まで
- BR-24-03: superseded_by が設定された記憶は検索対象から除外（論理削除相当）
- BR-24-04: embedding類似度 > 0.92 の既存記憶がある場合は重複挿入しない
- BR-24-05: 抽出処理失敗はAI回答を妨げない（ai_error_logsに記録）

## 受入基準（AC）

### AC-24-01: 事実抽出と保存
```gherkin
Given セッションが終了した（最終メッセージから30分経過）
When バックグラウンド処理が実行される
Then 会話から抽出された事実が student_episodic_memories に保存される
And 各記憶に importance スコアが付与されている
And 各記憶に embedding が生成されている
```

### AC-24-02: 次回セッションへの注入
```gherkin
Given 生徒Aに importance=8 の記憶が存在する
When 生徒AがSlackで新しいメッセージを送る
Then システムプロンプトにその記憶が含まれる
```

### AC-24-03: 記憶の更新（上書き）
```gherkin
Given 生徒Aに "数学が苦手"（importance:8）の記憶が存在する
When 新たに "数学が得意になってきた"（importance:8）が抽出される
Then 古い記憶の superseded_by に新記憶のIDがセットされる
And 新記憶がアクティブとして保存される
```

## 実装ステータス

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: - (Sprint 3 予定)
