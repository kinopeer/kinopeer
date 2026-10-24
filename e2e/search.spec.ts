import { expect, test, type Page } from '@playwright/test'
import { openApp, settle, type AppOptions } from './app.ts'

async function openSearch(page: Page, path: string, firstTitle: string, options: AppOptions = {}) {
  await openApp(page, path, options)
  await expect(page.getByRole('link', { name: new RegExp(firstTitle) }).first()).toBeVisible()
  await settle(page)
}

test.describe('search, phone', () => {
  test('trending and popular rows, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search', 'Дюна')
    await expect(page).toHaveScreenshot('browse-dark-ru.png')
  })

  test('results, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await expect(page).toHaveScreenshot('results-dark-ru.png')
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('results', async ({ page }) => {
      await openSearch(page, '/search?q=e', 'Dune', { theme: 'light', lang: 'en' })
      await expect(page).toHaveScreenshot('results-light-en.png')
    })
  })
})

test.describe('search, wide screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('results, dark, Russian', async ({ page }) => {
    await openSearch(page, '/search?q=%D0%B0', 'Дюна')
    await expect(page).toHaveScreenshot('results-wide-dark-ru.png')
  })
})
