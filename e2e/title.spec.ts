import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, showWholePage, type AppOptions } from './app.ts'
import { LONG_OVERVIEW_ID } from './fixtures.ts'

async function openTitle(page: Page, path: string, name: string, options: AppOptions = {}) {
  await openApp(page, path, options)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  // The whole page, so the screenshot shows the "In downloads" block under the overview.
  await expect(page.getByRole('region', { name: /^В загрузках/ })).toBeVisible()
  await showWholePage(page)
}

test('movie, dark, Russian', async ({ page }) => {
  await openTitle(page, '/title/movie/693134', 'Дюна: Часть вторая')
  await expect(page).toHaveScreenshot('movie-dark-ru.png')
})

test('series, dark, Russian', async ({ page }) => {
  await openTitle(page, '/title/tv/126308', 'Сёгун')
  await expect(page).toHaveScreenshot('series-dark-ru.png')
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('movie, dark, Russian', async ({ page }) => {
    await openTitle(page, '/title/movie/693134', 'Дюна: Часть вторая')
    await expect(page).toHaveScreenshot('desktop-movie-dark-ru.png')
  })

  test('series, dark, Russian', async ({ page }) => {
    await openTitle(page, '/title/tv/126308', 'Сёгун')
    await expect(page).toHaveScreenshot('desktop-series-dark-ru.png')
  })

  test('a long overview is cut to a few lines, and Show more opens it', async ({ page }) => {
    await openTitle(page, `/title/movie/${LONG_OVERVIEW_ID}`, 'Оппенгеймер')
    await expect(page).toHaveScreenshot('desktop-long-overview-dark-ru.png')
    await page.getByRole('button', { name: 'Подробнее' }).click()
    await expect(page.getByRole('button', { name: 'Свернуть' })).toBeVisible()
    await showWholePage(page)
    await expect(page).toHaveScreenshot('desktop-long-overview-open-dark-ru.png')
  })
})
