import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, settle, type AppOptions } from './app.ts'

/** Opens the app, then answers as a fresh install would and reloads, so the given setup step shows. */
async function openOnboarding(page: Page, step: 'connect' | 'tmdb', options: AppOptions = {}) {
  await openApp(page, '/', options)
  // Routes added later take precedence over the app's mocks.
  if (step === 'connect') {
    await page.route(
      (url) => url.pathname === '/qbt/api/v2/app/version',
      (route) => route.fulfill({ status: 403, body: 'Forbidden' }),
    )
  } else {
    await page.route(
      (url) => url.pathname === '/api/settings',
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            tmdb: { configured: false, source: null },
            prowlarr: { configured: true, source: 'env' },
            qbittorrent: { configured: true, source: 'saved' },
            downloads: null,
          }),
        }),
    )
  }
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await settle(page)
}

test.describe('onboarding, desktop', () => {
  test.use(DESKTOP)

  test('connect to qBittorrent, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'connect')
    await expect(page.getByRole('button', { name: 'Подключить' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-connect-dark-ru.png')
  })

  test('TMDB key, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'tmdb')
    await expect(page.getByRole('textbox', { name: 'Ключ API или токен доступа' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-tmdb-key-dark-ru.png')
  })
})

test.describe('onboarding, phone', () => {
  test('a wrong password, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'connect', { wrongLogin: true })
    await page.getByRole('textbox', { name: 'Логин' }).fill('admin')
    await page.getByLabel('Пароль').fill('wrong')
    await page.getByRole('button', { name: 'Подключить' }).click()
    await expect(page.getByText('Неверный логин или пароль')).toBeVisible()
    await expect(page).toHaveScreenshot('connect-invalid-dark-ru.png')
  })
})
