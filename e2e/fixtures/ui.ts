import type { Locator, Page } from '@playwright/test'

/**
 * トースト（Radix Toast.Root）。
 * role で引くと、モーダルダイアログが開いている間は aria-hidden 配下になり見つからない
 * （権限エラーはダイアログを開いたまま出るので、この経路が必要）。
 * Radix が Root に付ける data 属性で引く。TOAST_LIMIT = 1 なので常に 1 つ。
 */
export function toast(page: Page): Locator {
  return page.locator('li[data-state][data-swipe-direction]')
}

/**
 * 画面内のアラート（Alert コンポーネント）。
 * Next.js のルートアナウンサー（`#__next-route-announcer__`）も role="alert" を持ち
 * strict mode に引っかかるため除外する。
 */
export function alert(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)')
}
