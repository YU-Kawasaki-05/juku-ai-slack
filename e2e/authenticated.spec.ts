import { test, expect } from '@playwright/test'
import { ADMIN_STATE } from './fixtures/users'

/**
 * 認証後の基本フロー: ダッシュボード表示・全ナビゲーション巡回・404・ログアウト。
 * テストユーザーと storageState は global-setup が用意する。
 */
test.use({ storageState: ADMIN_STATE })

test.describe('ダッシュボード（SCR-02）', () => {
  test('見出し・KPI カード・kill_switch カードが表示される', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible()

    for (const kpi of ['今日の質問数', '今月のコスト', '未対応エラー', '生徒数']) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible()
    }

    // kill_switch カード（DEC-15）。状態は kill-switch.spec.ts が切り替えるのでどちらでも通す
    await expect(page.getByText('AI応答', { exact: true })).toBeVisible()
    await expect(page.getByText(/^(稼働中|停止中)$/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^AI応答を(停止|再開)$/ })).toBeVisible()
  })
})

const NAV = [
  ['ダッシュボード', '/admin', 'ダッシュボード'],
  ['生徒管理', '/admin/persons', '生徒管理'],
  ['チャンネル設定', '/admin/channels', 'チャンネル紐付け'],
  ['レポート', '/admin/reports', 'レポート管理'],
  ['会話ログ', '/admin/conversations', '会話ログ'],
  ['エラーログ', '/admin/errors', 'エラー管理'],
  ['ジョブ', '/admin/jobs', 'ジョブ管理'],
  ['利用状況', '/admin/usage', '利用状況'],
] as const

test.describe('管理画面ナビゲーション', () => {
  test('サイドバーの全リンクを巡回できる', async ({ page }) => {
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' })

    for (const [label, href, heading] of NAV) {
      const link = nav.getByRole('link', { name: label })
      await expect(link).toHaveAttribute('href', href)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }
  })

  for (const [, href, heading] of NAV) {
    test(`${href} を直接開くと 200 で表示される`, async ({ page }) => {
      const res = await page.goto(href)
      expect(res?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    })
  }
})

test.describe('不正な URL（H-5）', () => {
  // 詳細ページは isUuid() を通らない ID を notFound() にする
  const BAD_URLS = [
    '/admin/persons/not-a-uuid',
    '/admin/reports/not-a-uuid',
    '/admin/channels/not-a-uuid',
    '/admin/errors/not-a-uuid',
    '/admin/conversations/not-a-uuid',
  ]

  for (const url of BAD_URLS) {
    test(`${url} は日本語の 404 画面を返す`, async ({ page }) => {
      const res = await page.goto(url)
      expect(res?.status()).toBe(404)
      await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'ダッシュボードへ戻る' })).toBeVisible()
    })
  }
})

test.describe('会話ログ', () => {
  test('一覧が開けて空状態が出る', async ({ page }) => {
    await page.goto('/admin/conversations')
    await expect(page.getByRole('heading', { name: '会話ログ', level: 1 })).toBeVisible()
    await expect(page.getByText('会話がまだありません')).toBeVisible()
  })

  test('フィルタが URL に反映される', async ({ page }) => {
    await page.goto('/admin/conversations')
    await page.getByLabel('期間').click()
    await page.getByRole('option', { name: '直近7日' }).click()
    await expect(page).toHaveURL(/range=7/)
    await expect(page.getByText('条件に一致する会話がありません')).toBeVisible()
    await page.getByRole('button', { name: 'クリア' }).click()
    await expect(page).toHaveURL(/\/admin\/conversations$/)
  })
})

test.describe('エラー管理', () => {
  test('一覧が開けてフィルタが動く', async ({ page }) => {
    await page.goto('/admin/errors')
    await expect(page.getByRole('heading', { name: 'エラー管理', level: 1 })).toBeVisible()

    await page.getByLabel('深刻度').click()
    await page.getByRole('option', { name: 'エラーのみ' }).click()
    await expect(page).toHaveURL(/severity=error/)

    await page.getByLabel('対応状況').click()
    await page.getByRole('option', { name: '未対応のみ' }).click()
    await expect(page).toHaveURL(/resolved=false/)

    await expect(
      page.getByText(/エラーはありません|条件に一致するエラーがありません/),
    ).toBeVisible()
  })
})

test.describe('利用状況', () => {
  test('期間の切替が URL に反映される', async ({ page }) => {
    await page.goto('/admin/usage')
    await expect(page.getByRole('heading', { name: '利用状況', level: 1 })).toBeVisible()
    await page.getByRole('group', { name: '集計期間' }).getByRole('button', { name: '7日' }).click()
    await expect(page).toHaveURL(/range=7/)
  })
})
