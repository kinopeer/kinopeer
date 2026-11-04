import { expect, test, type Page } from '@playwright/test'
import { TORRENTS, torrent } from '../../src/test/fixtures.ts'
import { resetStand } from './control.ts'

/** Enough rows for the phone's Downloads to scroll well past a screen. */
const MANY = Array.from({ length: 40 }, (_, index) => {
  const { hash: _hash, ...fields } = TORRENTS[index % TORRENTS.length]
  return torrent(`t${index}`, fields)
})

const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

/** Scrolls the window to `y` and says where it stopped. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo(0, top), y)
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0)
  return scrollY(page)
}

/**
 * The tabs on a phone, in a real browser: what the hook's tests (with `scrollTo` mocked) can't see is
 * that the position read as a screen goes away is the one the user left (not the next screen's,
 * clamped), and that the window really lands there once the content is back, despite the browser's
 * own attempt. And a forward navigation, which the browser leaves where it was, opens at the top.
 */
test('each tab comes back where it was left, and the active tab goes to the top', async ({ page }) => {
  await resetStand({ torrents: MANY })
  const tabs = page.getByRole('navigation', { name: 'Основное' })
  const list = page.getByRole('region', { name: 'Загрузки' })

  await page.goto('/')
  await expect(list.getByRole('listitem')).toHaveCount(MANY.length)
  const downloadsY = await scrollTo(page, 1200)

  await tabs.getByRole('link', { name: 'Настройки' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible()
  expect(await scrollY(page)).toBe(0)
  const settingsY = await scrollTo(page, 400)

  await tabs.getByRole('link', { name: 'Поиск' }).click()
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('Сёгун')
  await page.getByRole('link', { name: /Сёгун/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()

  await tabs.getByRole('link', { name: 'Загрузки' }).click()
  await expect.poll(() => scrollY(page)).toBe(downloadsY)

  // A forward navigation from the scrolled list (a row on the screen, so the click doesn't scroll)
  // opens the torrent at the top; the Downloads tab, on there, goes back to the list where it was.
  const onScreen = await list
    .getByRole('link')
    .evaluateAll((links) => links.findIndex((link) => link.getBoundingClientRect().top > 200))
  await list.getByRole('link').nth(onScreen).click()
  await expect(page).toHaveURL(/\/torrent\//)
  // The URL changes before the screen renders (React Router renders in a transition).
  await expect(list).toBeHidden()
  expect(await scrollY(page)).toBe(0)
  await tabs.getByRole('link', { name: 'Загрузки' }).click()
  await expect.poll(() => scrollY(page)).toBe(downloadsY)
  // Pressed again on its own screen: to the top, smoothly.
  await tabs.getByRole('link', { name: 'Загрузки' }).click()
  await expect.poll(() => scrollY(page)).toBe(0)

  await tabs.getByRole('link', { name: 'Настройки' }).click()
  await expect.poll(() => scrollY(page)).toBe(settingsY)

  // The Search tab comes back with its query, so there's something to come back to.
  await tabs.getByRole('link', { name: 'Поиск' }).click()
  await expect(page).toHaveURL(/\/search\?q=/)
  await expect(page.getByRole('searchbox', { name: 'Поиск' })).toHaveValue('Сёгун')
})
