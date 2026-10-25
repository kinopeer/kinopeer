import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, showWholePage, type AppOptions } from './app.ts'

// Masked, so a version bump doesn't change the screenshots.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const versionValue = (page: Page) => page.getByText(version, { exact: true })

async function openSettings(page: Page, options: AppOptions = {}) {
  await openApp(page, '/settings', options)
  // Every connection check has answered.
  await expect(page.locator('.ks-conn.is-ok')).toHaveCount(3)
  await showWholePage(page)
}

test('dark, Russian', async ({ page }) => {
  await openSettings(page)
  await expect(page).toHaveScreenshot('settings-dark-ru.png', { mask: [versionValue(page)] })
})

test.describe('light, English', () => {
  test.use({ locale: 'en-US' })

  test('settings', async ({ page }) => {
    await openSettings(page, { theme: 'light', lang: 'en' })
    await expect(page).toHaveScreenshot('settings-light-en.png', { mask: [versionValue(page)] })
  })
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('desktop-dark-ru.png', { mask: [versionValue(page)] })
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('settings', async ({ page }) => {
      await openSettings(page, { theme: 'light', lang: 'en' })
      await expect(page).toHaveScreenshot('desktop-light-en.png', { mask: [versionValue(page)] })
    })
  })
})

test.describe('desktop rail', () => {
  test.use(DESKTOP_RAIL)

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('rail-dark-ru.png', { mask: [versionValue(page)] })
  })
})
