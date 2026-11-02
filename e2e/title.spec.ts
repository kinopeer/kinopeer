import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { LONG_OVERVIEW_ID } from './fixtures.ts'

async function openTitle(page: Page, path: string, name: string, options: AppOptions = {}) {
  await openApp(page, path, options)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  // The whole page, so the screenshot shows the "In downloads" block under the overview and the row
  // at the end: recommendations for a movie, similar titles for a series (see the mocks).
  await expect(page.getByRole('region', { name: /^В загрузках/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /^(Рекомендации|Похожее)$/ })).toBeVisible()
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

test('the pinned Find releases bar meets the tab bar while the page scrolls under it', async ({ page }) => {
  await openApp(page, '/title/tv/126308')
  const related = page.getByRole('region', { name: 'Похожее' })
  await expect(related).toBeVisible()
  await settle(page)
  // The similar titles' posters under the pinned bar and the tab bar, so a gap between them shows.
  await related.evaluate((row) => window.scrollTo(0, row.getBoundingClientRect().top + window.scrollY - 500))
  // The bar has no role of its own: its class is the opaque background that has to reach the tab bar.
  const bar = await page.locator('.title-actions').boundingBox()
  const tabs = await page.getByRole('navigation', { name: 'Основное' }).boundingBox()
  expect(bar!.y + bar!.height).toBe(tabs!.y)
  await expect(page).toHaveScreenshot('series-scrolled-dark-ru.png')
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
