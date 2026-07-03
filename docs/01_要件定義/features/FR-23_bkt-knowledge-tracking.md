---
id: FR-23
title: AI知識状態追跡（簡略化BKT）
priority: P1
status: defined
related_users: [U-01, U-02, U-03]
related_screens: [SCR-04]
version: 2
---

# FR-23: AI知識状態追跡（簡略化BKT）

## 概要

生徒の回答ごとにBKT（Bayesian Knowledge Tracing）アルゴリズムで習熟度 P(mastery) を更新し、
次回の回答生成プロンプトに注入する。Tutor LLM と Evaluator LLM を分離した2エージェント構成で、
Chain-of-Thought による評価精度を確保する。（DEC-20, DEC-24）

## アクター

- システム（Bot回答後に非同期実行）
- U-02 スタッフ（SCR-04で生徒の知識状態を確認）
- U-03 管理者

---

## 2エージェント分離アーキテクチャ（DEC-24）

```
生徒メッセージ
    │
    │ [同期] Tutor LLM
    ├─ P(mastery) ルックアップ → モード決定（FR-05）
    ├─ 回答 + 確認質問を生成
    └─ Slack に返信
           │
           │ [waitUntil() — 非同期]
           ▼
        Evaluator LLM
        ─────────────────────────
        入力: 直前の確認質問 + 生徒の返信
        出力: EvaluationSchema (Zod)
            { reasoning, signal, identified_misconception }
        ─────────────────────────
           │
           ├─ signal = "correct"   → updateBKT(is_correct=true)
           ├─ signal = "incorrect" → updateBKT(is_correct=false)
           ├─ signal = "partial"   → updateBKT(is_correct=false) [保守的]
           └─ signal = "skip"      → BKT 完全据え置き（遷移確率も更新しない）
                  │
                  ▼
        student_knowledge_states テーブルに UPSERT
                  │
                  ▼
        次回 FR-05 でプロンプト注入
```

**分離の理由**: 単一 LLM コールでは回答生成と評価が競合し精度が落ちる。
Evaluator を独立させることで「reasoning を先出し→signal を後出し」の Chain-of-Thought が強制できる。

---

## BKT 実装（TypeScript）

```typescript
// 外部ライブラリ不要 — 純粋な数式実装
export function updateBKT(
  p_mastery: number,
  is_correct: boolean,
  p_t = 0.15, // 学習率
  p_g = 0.2,  // ゲス率
  p_s = 0.1   // スリップ率
): number {
  const p_obs = is_correct
    ? (p_mastery * (1 - p_s)) / (p_mastery * (1 - p_s) + (1 - p_mastery) * p_g)
    : (p_mastery * p_s) / (p_mastery * p_s + (1 - p_mastery) * (1 - p_g))
  return p_obs + (1 - p_obs) * p_t
}

// 時間減衰（TASA論文準拠）: 1週間経過ごとに1%減衰
export function applyForgettingDecay(p_mastery: number, daysSinceLastSeen: number): number {
  const weeksPassed = daysSinceLastSeen / 7
  return p_mastery * Math.pow(0.99, weeksPassed)
}
```

---

## Evaluator LLM — Zod スキーマ（DEC-24）

```typescript
const EvaluationSchema = z.object({
  // reasoning を先に出力させることで Chain-of-Thought を強制する
  reasoning: z.string().describe(
    "生徒の回答を評価するための思考過程。signal を出力する前に必ず記述する"
  ),
  signal: z.enum(["correct", "incorrect", "partial", "skip"]).describe(
    "correct: 正解 / incorrect: 不正解 / partial: 部分的に正解 / " +
    "skip: 生徒がスキップ・拒否・無関係な返信をした"
  ),
  identified_misconception: z.string().nullable().describe(
    "incorrect/partial の場合に検出された誤概念または知識ギャップの短い要約。" +
    "correct/skip は null"
  ),
  // BKT 更新に必要なトピック情報
  topic_id: z.string().describe(
    "該当トピックID。例: '二次方程式' '因数分解' 'be動詞'。特定不能は 'unknown'"
  ),
  subject: z.string().describe("科目。例: '数学' '英語' '国語'"),
  confidence: z.number().min(0).max(1).describe("このシグナルに対するAIの確信度"),
})
```

### スキップ検出ルール（signal = "skip"）

以下のいずれかに該当する場合は `signal = "skip"` とする：

- 「次」「次へ」「スキップ」「パス」等の明示的スキップ語
- 「わからない」「わかんない」単独（質問の試みがない場合）
- スタンプのみ（絵文字リアクションで返信）
- 確認質問と無関係な全く別のトピックへの話題転換

---

## スキップ（skip）のBKT処理

**skip の場合は BKT を完全据え置きにする（遷移確率も更新しない）。**

```typescript
if (signal === "skip") {
  // updateBKT() を呼ばない
  // student_knowledge_states の p_mastery, attempt_count, last_seen_at を変更しない
  return // 早期リターン
}
```

**理由**: スキップを「不正解」として扱うと P(mastery) が不当に低下し、
学習意欲のない誤信号がBKT汚染を引き起こす。Slack環境でのスキップは
「評価への恐怖」や「忙しさ」が原因であり、理解不足を意味しない。

---

## トピック粒度

- 科目あたり5〜10の主要概念（過細分化しない）
- 例（数学）: 「二次方程式」「因数分解」「関数」「図形」「確率」
- 例（英語）: 「時制」「助動詞」「前置詞」「長文読解」「英作文」
- 未知トピックは動的に追加（`topic_id='unknown'` の場合はスキップ）

---

## プロンプト注入フォーマット

```
[生徒の知識状態 — AI参照用]
数学: 二次方程式(習得中:P=0.45,3回) / 因数分解(習得済:P=0.87) / 確率(苦手:P=0.18,2回)
英語: 時制(習得中:P=0.62,5回) / 前置詞(苦手:P=0.22,1回)
```

| P(mastery) | ラベル | プロンプト表示 |
|-----------|--------|-------------|
| P ≥ 0.95  | 習得済  | 短縮表示 or 省略 |
| 0.3 ≤ P < 0.95 | 習得中 | 通常表示 |
| P < 0.3   | 苦手   | 詳しく説明するよう促す（FR-05 direct モード） |

---

## マスタリー・苦手 判定

- P(mastery) ≥ 0.95 かつ連続正解3回 → status = 'mastered'
- P(mastery) < 0.3 → status = 'struggling'（SCR-04でスタッフに警告表示）
- P(mastery) = 0.2（初期値、P(L0)）= データなし状態

---

## ビジネスルール

- BR-23-01: `signal = "partial"` は `is_correct=false` として updateBKT() を呼ぶ（保守的評価）
- BR-23-02: `signal = "skip"` は updateBKT() を呼ばず、attempt_count も last_seen_at も更新しない
- BR-23-03: `confidence < 0.5` の抽出結果は DBに書き込まない
- BR-23-04: トピックごとに独立して P(mastery) を管理する（科目間の相関は無視）
- BR-23-05: 前回学習から14日以上経過した場合、次回の select で forgetting decay を適用
- BR-23-06: 抽出処理の失敗はAI回答を妨げない（サイレントフェイル、ai_error_logs に記録）
- BR-23-07: Evaluator LLM の呼び出しは Tutor LLM の返信送信後に waitUntil() で非同期実行する（生徒のレスポンス体験を妨げない）

---

## 受入基準（AC）

### AC-23-01: 正答後の習熟度上昇
```gherkin
Given 生徒Aの「二次方程式」の p_mastery が 0.45 である
When Evaluator LLM が signal=correct を返した
Then p_mastery が 0.45 より高い値に更新される
And student_knowledge_states テーブルに記録される
```

### AC-23-02: 誤答後の習熟度低下
```gherkin
Given 生徒Aの「因数分解」の p_mastery が 0.60 である
When Evaluator LLM が signal=incorrect を返した
Then p_mastery が 0.60 より低い値に更新される
```

### AC-23-03: スキップ時はBKTが変化しない
```gherkin
Given 生徒Aの「確率」の p_mastery が 0.35 である
And attempt_count が 3 である
When 生徒Aが「次」とだけ返信した
And Evaluator LLM が signal=skip を返した
Then p_mastery が 0.35 のまま変化しない
And attempt_count が 3 のまま変化しない
And last_seen_at が更新されない
```

### AC-23-04: reasoningが signal より先に生成される
```gherkin
Given Evaluator LLM が EvaluationSchema に従って回答する
When 生徒の返信を評価する
Then Zod オブジェクトの reasoning フィールドに内容が入っている
And reasoning が空文字列でない（Chain-of-Thought が実行されている）
```

### AC-23-05: プロンプト注入
```gherkin
Given 生徒Aに student_knowledge_states レコードが存在する
When 生徒Aの質問を処理する
Then システムプロンプトに知識状態サマリーが含まれる
```

### AC-23-06: SCR-04 への表示
```gherkin
Given 生徒Aに student_knowledge_states レコードが複数存在する
When スタッフが SCR-04（生徒詳細）を開く
Then トピック別の p_mastery バーが表示される
And 「苦手」判定トピックは強調表示される
```

### AC-23-07: 低確信度はDB書込みスキップ
```gherkin
Given Evaluator LLM が confidence=0.4 を返した
When BKT更新処理が実行される
Then student_knowledge_states は更新されない
And ai_error_logs に LOW_CONFIDENCE_SKIP が記録される
```

---

## 実装ステータス

- 実装ファイル: -
- テストファイル: -
- 最終確認Sprint: - (Sprint 3 予定)
