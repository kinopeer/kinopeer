import { expect, test } from '@playwright/test'
import { openApp, settle, showWholePage } from './app.ts'

test('downloading series with its files, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/a2')
  await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()
  await page.getByRole('button', { name: /^Episodes/ }).click()
  await expect(page.getByText(/Shogun\.S01E01/)).toBeVisible()
  await showWholePage(page)
  await expect(page).toHaveScreenshot('series-dark-ru.png')
})

test.describe('light, English', () => {
  test.use({ locale: 'en-US' })

  test('missing files', async ({ page }) => {
    await openApp(page, '/torrent/a8', { theme: 'light', lang: 'en' })
    await expect(page.getByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('error-light-en.png')
  })
})
