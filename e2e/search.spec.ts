import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, settle, type AppOptions } from './app.ts'

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

  test('no results, dark, Russian', async ({ page }) => {
    await openApp(page, '/search?q=zzz')
    await expect(page.getByRole('heading', { name: /zzz/ })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-no-results-dark-ru.png')
  })
})
