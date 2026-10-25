import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { RELEASES } from './fixtures.ts'

async function openReleases(page: Page, options: AppOptions = {}) {
  await openApp(page, '/title/tv/126308/releases', options)
  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  await settle(page)
}

test.describe('releases, phone', () => {
  test('results, dark, Russian', async ({ page }) => {
    await openReleases(page)
    await showWholePage(page)
    await expect(page).toHaveScreenshot('list-dark-ru.png')
  })

  test('filters sheet', async ({ page }) => {
    await openReleases(page)
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveScreenshot('filters-dark-ru.png')
  })

  test('adding a release, then picking its files', async ({ page }) => {
    await openReleases(page)
    await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    const files = page.getByRole('button', { name: /Файлы: все \(14\)/ })
    await expect(files).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('add-dark-ru.png')

    await files.click()
    await page.getByRole('button', { name: /^Episodes/ }).click()
    await expect(page.getByText(/Shogun\.S01E10/)).toBeVisible()
    await expect(page).toHaveScreenshot('add-files-dark-ru.png')
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('results', async ({ page }) => {
      await openReleases(page, { theme: 'light', lang: 'en' })
      await showWholePage(page)
      await expect(page).toHaveScreenshot('list-light-en.png')
    })
  })
})

/** The title page with its releases searched, scrolled to them. */
async function findReleases(page: Page, options: AppOptions = {}) {
  await openApp(page, '/title/tv/126308', options)
  await page.getByRole('button', { name: /^(Найти раздачи|Find releases)$/ }).click()
  await expect(page).toHaveURL(/\/title\/tv\/126308\/releases$/)
  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  // Off the table, so no row shows its hover state.
  await page.mouse.move(0, 0)
  await settle(page)
}

test.describe('releases, desktop', () => {
  test.use(DESKTOP)

  test('searched from the title page, dark, Russian', async ({ page }) => {
    await findReleases(page)
    await expect(page).toHaveScreenshot('desktop-list-dark-ru.png')
  })

  test('a filter popover', async ({ page }) => {
    await findReleases(page)
    await page.getByRole('button', { name: 'Озвучка' }).click()
    await expect(page.getByRole('group', { name: 'Озвучка' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-popover-dark-ru.png')
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('opened at the releases link', async ({ page }) => {
      await openApp(page, '/title/tv/126308/releases', { theme: 'light', lang: 'en' })
      await expect(page.getByText(RELEASES[0].title)).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot('desktop-list-light-en.png')
    })
  })
})

test.describe('releases, desktop icon rail', () => {
  test.use(DESKTOP_RAIL)

  test('searched, dark, Russian', async ({ page }) => {
    await findReleases(page)
    await expect(page).toHaveScreenshot('rail-list-dark-ru.png')
  })
})
