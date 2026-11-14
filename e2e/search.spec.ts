import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { DESKTOP, DESKTOP_RAIL, emulateNotch, openApp, settle, type AppOptions } from './app.ts'

async function openSearch(page: Page, path: string, firstTitle: string, options: AppOptions = {}) {
  await openApp(page, path, options)
  await expect(page.getByRole('link', { name: new RegExp(firstTitle) }).first()).toBeVisible()
  await settle(page)
}

test.describe('search, phone', () => {
  test('browse rows, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search', 'Дюна')
    await expect(page).toHaveScreenshot('browse-dark-ru.png')
  })

  test('results, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await expect(page).toHaveScreenshot('results-dark-ru.png')
  })

  test('results, the next page failed, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна', { searchMoreFails: true })
    await page.getByRole('button', { name: 'Показать ещё' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    // To the end of the list, where the note stands clear of the tab bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await settle(page)
    await expect(page).toHaveScreenshot('results-more-failed-dark-ru.png')
  })

  test('the field and the filters stay at the top while the results scroll', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300)
    // The title scrolls away; the field, the type tabs and the year are pinned.
    await expect(page.getByRole('heading', { level: 1, name: 'Поиск' })).not.toBeInViewport()
    await expect(page.getByRole('searchbox', { name: 'Поиск' })).toBeInViewport()
    await expect(page.getByRole('group', { name: 'Тип' })).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Год выхода' })).toBeInViewport()
    // How it looks scrolled is the next page's failure above and the notched phone's screenshot.
  })

  test('the results stay out of the status bar above the pinned field', async ({ page }) => {
    await emulateNotch(page)
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300)
    await expect(page).toHaveScreenshot('results-scrolled-safe-area-dark-ru.png')
  })

  test.describe('a narrow phone', () => {
    // A common Android width, where the year field has to give way beside the tabs.
    test.use({ viewport: { width: 360, height: 800 } })

    test('results for a year, dark, Russian', async ({ page }) => {
      await openSearch(page, '/search?q=%D0%B0&year=2022', 'Разделение')
      await expect(page).toHaveScreenshot('narrow-year-results-dark-ru.png')
    })
  })
})

test.describe('search, desktop', () => {
  test.use(DESKTOP)

  test('browse rows, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search', 'Дюна')
    await expect(page).toHaveScreenshot('desktop-browse-dark-ru.png')
  })

  test('results, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await expect(page).toHaveScreenshot('desktop-results-dark-ru.png')
  })

  test('the field and the filters stay at the top while the results scroll', async ({ page }) => {
    // A short window, so the results scroll.
    await page.setViewportSize({ width: 1440, height: 500 })
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await page.evaluate(() => window.scrollTo(0, 120))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120)
    // The title scrolls away, as on a phone; the field, the type tabs and the year are pinned.
    await expect(page.getByRole('heading', { level: 1, name: 'Поиск' })).not.toBeInViewport()
    await expect(page.getByRole('searchbox', { name: 'Поиск' })).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Год выхода' })).toBeInViewport()
    await expect(page).toHaveScreenshot('desktop-results-scrolled-dark-ru.png')
  })

  test('no results, dark, Russian', async ({ page }) => {
    await openApp(page, '/search?q=zzz')
    await expect(page.getByRole('heading', { name: /zzz/ })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-no-results-dark-ru.png')
  })
})

test.describe('search, icon rail', () => {
  test.use(DESKTOP_RAIL)

  test('the field and the filters stay at the top beside the rail while the results scroll', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await page.evaluate(() => window.scrollTo(0, 150))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(150)
    await expect(page.getByRole('heading', { level: 1, name: 'Поиск' })).not.toBeInViewport()
    await expect(page).toHaveScreenshot('rail-results-scrolled-dark-ru.png')
  })
})
