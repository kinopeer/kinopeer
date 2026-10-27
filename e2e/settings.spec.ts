import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, showWholePage, type AppOptions } from './app.ts'

// Masked, so a version bump doesn't change the screenshots.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const versionValue = (page: Page) => page.getByText(version, { exact: true })

async function openSettings(page: Page, options: AppOptions = {}, connected = 3) {
  await openApp(page, '/settings', options)
  // Every connection check has answered.
  await expect(page.getByRole('status').filter({ hasText: /^Подключено/ })).toHaveCount(connected)
  await showWholePage(page)
}

test('dark, Russian', async ({ page }) => {
  await openSettings(page)
  await expect(page).toHaveScreenshot('settings-dark-ru.png', { mask: [versionValue(page)] })
})

test('a connection with an error, dark, Russian', async ({ page }) => {
  await openSettings(page, { prowlarrDown: true }, 2)
  await expect(page.getByText('Prowlarr не отвечает')).toBeVisible()
  await expect(page).toHaveScreenshot('settings-error-dark-ru.png', { mask: [versionValue(page)] })
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('desktop-dark-ru.png', { mask: [versionValue(page)] })
  })
})

test.describe('desktop rail', () => {
  test.use(DESKTOP_RAIL)

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('rail-dark-ru.png', { mask: [versionValue(page)] })
  })
})
