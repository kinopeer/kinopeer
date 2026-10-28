import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { GB, RELEASES } from './fixtures.ts'

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

  test('some indexers didn’t answer', async ({ page }) => {
    await openReleases(page, { failingIndexers: ['Kinozal', 'RuTracker'] })
    await expect(page.getByRole('status')).toHaveText('2 индексатора не ответили: Kinozal, RuTracker')
    await expect(page).toHaveScreenshot('failing-indexers-dark-ru.png')
  })

  test('some indexers didn’t answer and nothing was found', async ({ page }) => {
    await openApp(page, '/title/tv/126308/releases', { failingIndexers: ['Kinozal', 'RuTracker'], noReleases: true })
    await expect(page.getByRole('heading', { name: 'Раздачи не найдены' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('2 индексатора не ответили: Kinozal, RuTracker')
    await settle(page)
    await expect(page).toHaveScreenshot('failing-indexers-none-dark-ru.png')
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

  test('adding a release larger than the free space', async ({ page }) => {
    await openReleases(page, { freeSpace: 48 * GB })
    await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    await expect(page.getByText('Недостаточно места')).toBeVisible()
    await expect(page.getByRole('button', { name: /Файлы: все \(14\)/ })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('add-low-space-dark-ru.png')
  })
})

/** The title page with its releases searched, scrolled to them. */
async function findReleases(page: Page, options: AppOptions = {}) {
  await openApp(page, '/title/tv/126308', options)
  await page.getByRole('button', { name: 'Найти раздачи' }).click()
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

  test('some indexers didn’t answer', async ({ page }) => {
    await findReleases(page, { failingIndexers: ['Kinozal', 'RuTracker'] })
    await expect(page.getByRole('status')).toHaveText('2 индексатора не ответили: Kinozal, RuTracker')
    await expect(page).toHaveScreenshot('desktop-failing-indexers-dark-ru.png')
  })

  test('a filter popover', async ({ page }) => {
    await findReleases(page)
    await page.getByRole('button', { name: 'Озвучка' }).click()
    await expect(page.getByRole('group', { name: 'Озвучка' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-popover-dark-ru.png')
  })
})

test.describe('releases, desktop icon rail', () => {
  test.use(DESKTOP_RAIL)

  test('searched, dark, Russian', async ({ page }) => {
    await findReleases(page)
    await expect(page).toHaveScreenshot('rail-list-dark-ru.png')
  })
})
