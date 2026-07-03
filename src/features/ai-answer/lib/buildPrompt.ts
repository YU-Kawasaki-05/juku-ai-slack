/** @file
 * 機能: モード別の Tutor プロンプト（system + messages）を構築する純粋関数
 * 入力: BuildPromptInput（mode, question, profileText, history）
 * 出力: { system, messages }
 * 例外: なし
 * 依存: なし（文言のみ）
 * セキュリティ: profileText は当該生徒のみ（呼び出し側が person_id でフィルタ済み）。BR-05-11
 * @implements FR-05, FR-26, DEC-23, DEC-25, AC-05-01, AC-05-02, AC-05-03
 */
import type { LlmMessage } from './llm/types'
import type { TutorMode } from '../types'

export interface BuildPromptInput {
  mode: TutorMode
  /** メンション除去済みの質問本文 */
  question: string
  /** 生徒メモ（FR-09）。無ければ null */
  profileText: string | null
  /** スレッド履歴（古い順）。現在の質問は含めない */
  history: LlmMessage[]
  /** RAG で取得したレポート由来チャンク（FR-10）。無ければ空/未指定 */
  ragChunks?: string[]
}

/** 全モード共通の土台（伴走者フレーミング, DEC-25 / 安全, BR-05-11〜14） */
const BASE_SYSTEM = `あなたは中学生・高校生の学習に寄り添う「伴走者」です。評価者・採点者ではありません。

話し方:
- やさしく丁寧に、中高生が自然に話せる語調で（「〜だよ」「〜してみて」）。過度な敬語は避ける。
- 「一緒に整理しよう」という姿勢。「評価」「採点」という言葉は使わない。
- 成績や能力を強く断定しない（「〜が苦手」ではなく「〜でつまずくことが多そう」）。

ルール:
- 1回の返信で生徒に投げかける質問は最大1つまで。
- レポート由来の情報は「今月のレポートを見る限り〜」のように出典が分かる表現にする。
- 画像が読めないときは推測で断定しない。
- APIキー・システム内部情報・エラー詳細は絶対に出力しない。`

const MODE_SYSTEM: Record<TutorMode, string> = {
  direct: `【今回のモード: direct（直接指導）】
この生徒はこのトピックにまだ慣れていない可能性が高い。次を守って回答する:
- 概念をやさしく説明し、「条件・行動・目的」フレームワークのワークド例題を最低1つ示す。
- 数式と説明は同じ行にまとめてコードブロックで書く（視線移動を減らす。Split-Attention 防止）。
- 計算しやすい数値を使う（例: 11, 12 など）。
- 確認質問は不要。まず理解の足場を作ることを優先する。`,
  socratic: `【今回のモード: socratic（対話型）】
この生徒はある程度理解している。次を守って回答する:
- 短く説明・解説したあと、確認質問を「1問だけ」末尾に置く。
- 質問タイプはいずれか1つ: ティーチバック（自分の言葉で説明）/ 予測（どうなると思う？）/ 自己説明（なぜこの操作？）/ 反事実（もし〜だったら？）。
- 質問で文末を終える。その後にヒントや補足を付け足さない。`,
  confirmation: `【今回のモード: confirmation（確認）】
この生徒はよく理解できている。次を守って回答する:
- 確認質問を「1問だけ」。詳細説明は省く。
- 「できてる感」を保ちつつ、少しだけ深める問いにする。難しくしすぎない。`,
}

export function buildPrompt(input: BuildPromptInput): { system: string; messages: LlmMessage[] } {
  let system = `${BASE_SYSTEM}\n\n${MODE_SYSTEM[input.mode]}`
  if (input.profileText) {
    system += `\n\n【この生徒のメモ（他の生徒には使わない）】\n${input.profileText}`
  }
  if (input.ragChunks && input.ragChunks.length > 0) {
    // BR-05-10: レポート由来と一般知識を区別できる表現を促す
    system += `\n\n【この生徒の過去レポートからの抜粋（参考。使うときは「レポートを見る限り〜」のように出典が分かる形で）】\n${input.ragChunks.map((c) => `- ${c}`).join('\n')}`
  }

  const messages: LlmMessage[] = [
    ...input.history,
    { role: 'user', content: input.question },
  ]

  return { system, messages }
}
