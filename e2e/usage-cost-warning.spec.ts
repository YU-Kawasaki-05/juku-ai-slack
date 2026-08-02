import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'
import { adminDb, createPerson, deletePersons, uniqueSuffix } from './fixtures/db'

/**
 * #7: 単価未登録のモデルを使うと estimated_cost=0 で記録され、コスト表示が実額より小さく出る。
 * 画面に説明が無いと「安い」と誤解したまま運用が続くため、警告と対処手順が出ることを確かめる。
 */
test.use({ storageState: ADMIN_STATE })

const personIds: string[] = []
const models: string[] = []

test.afterAll(async () => {
  if (models.length > 0) await adminDb().from('ai_usage_logs').delete().in('model', models)
  await deletePersons(personIds)
})

test('単価未登録のモデルが使われていると /admin/usage に警告と対処手順が出る', async ({ page }) => {
  const suffix = uniqueSuffix()
  const model = `e2e-unpriced-${suffix}`
  const person = await createPerson(`E2E 単価未登録 ${suffix}`)
  personIds.push(person.id)
  models.push(model)

  const { error } = await adminDb().from('ai_usage_logs').insert({
    person_id: person.id,
    slack_channel_id: `C_E2E_${suffix}`,
    thread_ts: `${suffix}.1`,
    message_ts: `${suffix}.1`,
    model,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    // 単価が引けないので 0 で記録される（これがコスト過少表示の正体）
    estimated_cost: 0,
  })
  expect(error).toBeNull()

  await page.goto('/admin/usage')

  const alert = page.getByRole('alert').filter({ hasText: '単価が未登録のモデル' })
  await expect(alert).toBeVisible()
  // どのモデルが原因かを名指しする
  await expect(alert).toContainText(model)
  // 直し方まで画面に出す（constants.ts に追加 → 再デプロイ、既存ログは再計算されない）
  await expect(alert).toContainText('MODEL_PRICING')
  await expect(alert).toContainText('遡って再計算されない')
})
