/** @file
 * 機能: 生徒（persons）の入力バリデーション
 * @implements FR-14, AC-14-02
 */
import { z } from 'zod'

// 空文字は「未入力」として null に正規化するヘルパー
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable()

export const personCreateSchema = z.object({
  name: z.string().trim().min(1, '名前は必須です').max(100),
  displayName: optionalText(100),
  grade: optionalText(50),
  status: z.enum(['active', 'inactive']).default('active'),
  guardianEmail: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .nullable()
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: 'メールアドレスの形式が正しくありません',
    }),
})

export const personUpdateSchema = personCreateSchema.extend({
  id: z.string().uuid(),
})

export type PersonCreateInput = z.infer<typeof personCreateSchema>
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>
