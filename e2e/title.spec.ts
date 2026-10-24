import { expect, test, type Page } from '@playwright/test'
import { openApp, showWholePage, type AppOptions } from './app.ts'

async function openTitle(page: Page, path: string, name: string, options: AppOptions = {}) {
  await openApp(page, path, options)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  // The whole page, so the screenshot shows the "In downloads" block under the overview.
  await expect(page.getByRole('region', { name: /^(In downloads|В загрузках)/ })).toBeVisible()
  await showWholePage(page)
}

test('movie, dark, Russian', async ({ page }) => {
  await openTitle(page, '/title/movie/693134', 'Дюна: Часть вторая')
  await expect(page).toHaveScreenshot('movie-dark-ru.png')
})

test.describe('light, English', () => {
  test.use({ locale: 'en-US' })

  test('series', async ({ page }) => {
    await openTitle(page, '/title/tv/126308', 'Shōgun', { theme: 'light', lang: 'en' })
    await expect(page).toHaveScreenshot('series-light-en.png')
  })
})
