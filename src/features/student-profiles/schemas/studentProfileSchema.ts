/** @file
 * 機能: 生徒プロフィール（student_profiles）の入力バリデーション
 * 備考: 文字数上限は FR-09 の入力データ定義に合わせる（列は TEXT なので DB 側の制約ではない）。
 *   summary は FR-09 上は必須だが、試験期間だけ設定したい運用を塞がないため任意にしている
 *   （BR-09-04: プロフィールが無くても回答は継続する）
 * @implements FR-09, AC-09-01, BR-09-01, DEC-18
 */
import { z } from 'zod'
import { examDateToUntilIso, jstToday } from '../lib/examPeriod'

/** 試験科目の上限（TEXT[] に DB 制約は無いので入力側で歯止めをかける） */
const MAX_SUBJECTS = 20
const MAX_SUBJECT_LENGTH = 50

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 空文字は「未入力」として null に正規化する（列を NULL に戻せるようにする）
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}は${max}文字以内で入力してください`)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable()

/** 「数学, 英語」「数学、英語」→ ['数学', '英語']。空なら null */
export function parseExamSubjects(raw: string | undefined | null): string[] | null {
  const items = (raw ?? '')
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? items : null
}

export const studentProfileSchema = z
  .object({
    personId: z.string().uuid(),
    summary: optionalText(2000, '全体要約'),
    learningStyle: optionalText(500, '学習スタイル'),
    strengths: optionalText(500, '得意分野'),
    weaknesses: optionalText(500, '苦手分野'),
    instructionNotes: optionalText(1000, '指導上の注意'),
    examMode: z.boolean(),
    examEndDate: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : '')),
    examSubjects: z
      .string()
      .optional()
      .transform((v) => v ?? ''),
  })
  .superRefine((v, ctx) => {
    const subjects = parseExamSubjects(v.examSubjects)
    if (subjects && subjects.length > MAX_SUBJECTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examSubjects'],
        message: `試験科目は${MAX_SUBJECTS}件以内で入力してください`,
      })
    }
    if (subjects?.some((s) => s.length > MAX_SUBJECT_LENGTH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examSubjects'],
        message: `試験科目は1件あたり${MAX_SUBJECT_LENGTH}文字以内で入力してください`,
      })
    }

    if (!v.examMode) return

    if (!v.examEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examEndDate'],
        message: '試験期間の最終日を入力してください',
      })
      return
    }
    if (!DATE_PATTERN.test(v.examEndDate) || Number.isNaN(Date.parse(v.examEndDate))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examEndDate'],
        message: '日付の形式が正しくありません',
      })
      return
    }
    // 過去日は保存できても効かない（BR-05-08 の判定が即 false になる）。設定したつもりを作らない
    if (v.examEndDate < jstToday()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examEndDate'],
        message: '試験期間の最終日は今日以降を指定してください',
      })
    }
  })
  .transform((v) => ({
    personId: v.personId,
    summary: v.summary,
    learningStyle: v.learningStyle,
    strengths: v.strengths,
    weaknesses: v.weaknesses,
    instructionNotes: v.instructionNotes,
    // OFF のときは列を NULL に戻す。古い日付を残すと「解除したのに効いている/いない」が分からなくなる
    examModeUntil: v.examMode ? examDateToUntilIso(v.examEndDate) : null,
    examSubjects: parseExamSubjects(v.examSubjects),
  }))

export type StudentProfileInput = z.infer<typeof studentProfileSchema>
