import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { GB, RELEASES } from './fixtures.ts'

/** A remembered 2160p, which these releases have, and a dub, which none of them has. */
const REMEMBERED = { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 }

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

  test('remembered filters, one set aside', async ({ page }) => {
    await openReleases(page, { releaseFilters: REMEMBERED })
    await expect(page.getByText('Запомненные фильтры не применены: Дубляж')).toBeVisible()
    await expect(page).toHaveScreenshot('remembered-dark-ru.png')
  })

  // In the count's line, which has to stay on one line at a phone's width; the names on a tap.
  test('some indexers didn’t answer', async ({ page }) => {
    await openReleases(page, { failingIndexers: ['Indexer C', 'Indexer D'] })
    const failed = page.getByRole('button', { name: '2 индексатора не ответили' })
    await expect(failed).toBeVisible()
    await expect(page).toHaveScreenshot('failing-indexers-dark-ru.png')

    await failed.click()
    await expect(page.getByText('Indexer C, Indexer D')).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('failing-indexers-named-dark-ru.png')
  })

  test('some indexers didn’t answer and nothing was found', async ({ page }) => {
    await openApp(page, '/title/tv/126308/releases', { failingIndexers: ['Indexer C', 'Indexer D'], noReleases: true })
    await expect(page.getByRole('heading', { name: 'Раздачи не найдены' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('2 индексатора не ответили: Indexer C, Indexer D')
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

  test('remembered filters, one set aside', async ({ page }) => {
    await findReleases(page, { releaseFilters: REMEMBERED })
    await expect(page.getByText('Запомненные фильтры не применены: Дубляж')).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-remembered-dark-ru.png')
  })

  test('some indexers didn’t answer, named', async ({ page }) => {
    await findReleases(page, { failingIndexers: ['Indexer C', 'Indexer D'] })
    await page.getByRole('button', { name: '2 индексатора не ответили' }).click()
    await expect(page.getByText('Indexer C, Indexer D')).toBeVisible()
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-failing-indexers-dark-ru.png')
  })

  test('a filter popover', async ({ page }) => {
    await findReleases(page)
    await page.getByRole('button', { name: 'Озвучка' }).click()
    await expect(page.getByRole('group', { name: 'Озвучка' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-popover-dark-ru.png')
  })

  // The sortable column whose name with the arrow fits most tightly, sorted; ascending, which no
  // other shot of this table shows, with another column's name hovered.
  test('sorted by a column’s header, oldest first', async ({ page }) => {
    await findReleases(page)
    const age = page.getByRole('table').getByRole('button', { name: 'Возраст' })
    await age.click()
    await age.click()
    await expect(page.getByRole('columnheader', { name: 'Возраст' })).toHaveAttribute('aria-sort', 'ascending')
    await page.getByRole('table').getByRole('button', { name: 'Размер' }).hover()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-sorted-dark-ru.png')
  })
})

test.describe('releases, desktop icon rail', () => {
  test.use(DESKTOP_RAIL)

  test('searched, dark, Russian', async ({ page }) => {
    await findReleases(page)
    await expect(page).toHaveScreenshot('rail-list-dark-ru.png')
  })
})
