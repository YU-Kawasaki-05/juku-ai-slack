---
id: FR-25
title: FSRSスペース反復リマインダー
priority: P2
status: defined
related_users: [U-01]
related_screens: []
phase: 2
version: 1
---

# FR-25: FSRSスペース反復リマインダー

## 概要

生徒が間違えた概念（誤概念）を自動的にFSRSアルゴリズムでスケジューリングし、
最適なタイミングでSlackにリマインダーを送信する。
「先週つまずいた問題、今日確認してみよう！」という自然な復習体験。（DEC-22）

**Phase 2 機能**: Sprint 5 以降で実装。基本BKT（FR-23）の蓄積後に有効化。

## 前提ライブラリ

```
npm install ts-fsrs
```

公式実装、v6対応、完全TypeScript型定義、ゼロ依存ライブラリ不要。

## アクター

- システム（FR-23のBKT抽出後に誤概念を登録）
- Cron（毎日8:00 JSTにdue概念をチェック）
- Bot（Slackリマインダー送信）

---

## レビューアイテムの定義

フラッシュカードの「表と裏」は使わない。

- **レビュー単位**: 「知識マイクロ概念」= 生徒が間違えた具体的な知識ブロック
- 例: "二次方程式の解の公式でルートを整理するステップ" / "be動詞の過去形変化"
- FR-23でP(mastery) < 0.3 かつ attempt_count ≥ 2 の場合にFSRSカードを自動生成

## パイプライン

```
Phase 1: 誤概念の検出と登録
FR-23 の BKT 更新時、cognitive_gap が non-null かつ P(mastery) < 0.3
    ↓
learning_concepts テーブルに ts-fsrs の createEmptyCard() で初期カード登録

Phase 2: リマインダー配信（毎日8:00 JSTのCron）
SELECT * FROM learning_concepts
  WHERE person_id = ? AND due <= now() AND state != 3 -- 3:Relearning除外
    ↓
複数due概念がある場合はLLMで1問に合成（LinGoatパターン）
例: "二次方程式" + "因数分解" → 両方を含む応用問題を1問生成
    ↓
Bot が生徒のSlackチャンネルに送信
"先週、二次方程式の計算でルートの整理でつまずいてたね :thinking_face:
今日 x²-12=0 を一緒に確認してみようか？"
    ↓ 生徒が返答
LLM が回答を評価 → Rating(Again/Hard/Good/Easy) に変換
    ↓
ts-fsrs scheduler.next() で FSRSカード状態を更新
    ↓
learning_concepts テーブルを UPDATE
```

## Rating マッピング

| 生徒の回答の特性 | LLM判定 | Rating |
|-----------------|---------|--------|
| 全く解けない / "わからない" | 忘却 | Again(1) |
| ヒント後にようやく解答 | 困難 | Hard(2) |
| 自力で正解 | 良好 | Good(3) |
| 即座に完璧な回答 | 容易 | Easy(4) |

## ts-fsrs 設定

```typescript
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs'

const f = fsrs({
  request_retention: 0.90, // 90%保持率（認知科学的最適値）
  maximum_interval: 365,   // 最大間隔1年
  enable_fuzz: true,       // 通知スパム防止のための間隔ランダム化
})
```

## Slackメッセージフォーマット

```
[リマインダーメッセージ例]
先週、{topic}で少し詰まってたね :memo:
今日は短い問題で確認しよう！

{ai_generated_question}

わかったら答えを送ってね :raised_hands:
```

---

## ビジネスルール

- BR-25-01: 1日に同じ生徒へ送るリマインダーは最大3件まで
- BR-25-02: 生徒が返答しなかった場合（48時間）はRating=Againとして処理
- BR-25-03: P(mastery) ≥ 0.95（FR-23 mastered）になった概念のFSRSカードは自動アーカイブ
- BR-25-04: リマインダーの送信時間は8:00〜21:00 JSTのみ
- BR-25-05: 試験前モード中（DEC-18）はリマインダーを一時停止

## 受入基準（AC）

### AC-25-01: 誤概念の自動登録
```gherkin
Given 生徒Aの「因数分解」の p_mastery が 0.2 で attempt_count が 2
When BKT更新処理が実行される
Then learning_concepts に ts-fsrs 初期カードが登録される
And due が近日中に設定されている
```

### AC-25-02: Slackリマインダー送信
```gherkin
Given learning_concepts に due が過去の概念が存在する
When 毎日8:00 JSTのCronが実行される
Then 生徒のSlackチャンネルに復習問題が送信される
```

### AC-25-03: 評価後の間隔延長
```gherkin
Given 生徒が復習問題に正解した（Rating=Good）
When ts-fsrs scheduler.next() が実行される
Then learning_concepts の due が更新される
And scheduled_days が前回より延長されている
```

## 実装ステータス

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: - (Sprint 5 予定)
