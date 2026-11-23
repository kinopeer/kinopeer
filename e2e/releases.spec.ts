import type { Locator, Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { DESKTOP, DESKTOP_RAIL, emulateNotch, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { GB, NOW, RELEASES, shogunInfoHash, torrent } from './fixtures.ts'

/**
 * qBittorrent's torrents for Free up space (#580): three on the default save path's disk, under
 * /downloads, and one elsewhere, which may be another disk.
 */
const daysAgo = (days: number) => NOW / 1000 - days * 86_400
const TO_FREE_UP: AppOptions = {
  freeSpace: 48 * GB,
  torrents: [
    torrent('dune', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', size: 76 * GB, progress: 1, ratio: 1.42, added_on: daysAgo(200), save_path: '/downloads/movies', content_path: '/downloads/movies/dune' }),
    torrent('oppenheimer', { name: 'Oppenheimer.2023.1080p.BluRay.x264-GRPB', size: 18 * GB, progress: 1, ratio: 0.31, added_on: daysAgo(45), save_path: '/downloads/movies', content_path: '/downloads/movies/oppenheimer' }),
    torrent('bear', { name: 'The.Bear.S03.1080p.WEB-DL-GRPC', size: 24 * GB, progress: 0.5, added_on: daysAgo(3), save_path: '/downloads/tv', content_path: '/downloads/tv/bear' }),
    torrent('archive', { name: 'Blade.Runner.1982.Final.Cut.1080p.BluRay-GRPD', size: 32 * GB, progress: 1, ratio: 4.1, added_on: daysAgo(700), save_path: '/mnt/archive', content_path: '/mnt/archive/archive' }),
  ],
}

/** The add sheet over too little space, then Free up space from its warning, one torrent picked. */
async function freeUpSpace(page: Page, open: () => Promise<void>) {
  await open()
  await page.getByRole('button', { name: 'Освободить место' }).click()
  const step = page.getByRole('dialog', { name: 'Освободить место' })
  await expect(step.getByRole('region', { name: 'Может быть на другом диске' })).toBeVisible()
  await step.getByRole('checkbox', { name: /^Oppenheimer/ }).check()
  await settle(page)
}

/** A remembered 2160p, which these releases have, and a dub, which none of them has. */
const REMEMBERED = { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 }

/**
 * The top release with its info hash, and qBittorrent with its torrent (#375), named as the torrent
 * names itself rather than as the indexer lists it, so on desktop the title page's "In downloads"
 * doesn't repeat the release's name.
 */
const TOP_IN_DOWNLOADS: AppOptions = {
  releases: [{ ...RELEASES[0], infoHash: shogunInfoHash() }, ...RELEASES.slice(1)],
  torrents: [torrent(shogunInfoHash(), { name: 'Shogun.S01.2160p.WEB-DL.HDR.DV.MVO-GRPA', progress: 0.4 })],
}

/**
 * Each row's Add or In downloads fits its cell, rather than spilling over the gap before it (#471):
 * every one of the `count` releases' actions, found by role and name, so a miss fails.
 */
async function expectActionsInTheirCells(page: Page, count: number) {
  const table = page.getByRole('table')
  const actions = [
    ...(await table.getByRole('button', { name: 'Добавить' }).all()),
    ...(await table.getByRole('link', { name: 'В загрузках' }).all()),
  ]
  expect(actions).toHaveLength(count)
  const spills = []
  for (const action of actions) {
    const fits = await action.evaluate((element) => {
      const cell = element.closest('[role="cell"]')
      if (!cell) return false
      const outer = cell.getBoundingClientRect()
      const inner = element.getBoundingClientRect()
      return inner.left >= outer.left && inner.right <= outer.right
    })
    if (!fits) spills.push(await action.textContent())
  }
  expect(spills).toEqual([])
}

/**
 * Where the action column starts on desktop (1440px): the same with Add only, with In downloads and
 * in the skeleton, so no column moves as a poll marks a release or the results arrive (#471).
 */
const ACTION_COLUMN_LEFT = 1255

/** The left edge of the cell holding `action`, or of `action` itself when it is a cell's placeholder. */
async function expectActionColumnAt(action: Locator) {
  const left = await action.evaluate((element) => (element.closest('[role="cell"]') ?? element).getBoundingClientRect().left)
  expect(left).toBe(ACTION_COLUMN_LEFT)
}

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

  // A query edited and searched, with Reset query in the field (#582).
  test('an edited query', async ({ page }) => {
    await openReleases(page)
    const field = page.getByRole('searchbox', { name: 'Поисковый запрос' })
    await field.fill('Shogun 2024 2160p')
    await field.press('Enter')
    await expect(page.getByRole('button', { name: 'Сбросить запрос' })).toBeVisible()
    await expect(page.getByText(RELEASES[0].title)).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('query-edited-dark-ru.png')
  })

  // The query field scrolls away under the title bar; the bar and the filter chips stay pinned (#582).
  test('the title bar and the filters stay at the top while the list scrolls', async ({ page }) => {
    await emulateNotch(page)
    await openReleases(page)
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)
    await expect(page.getByRole('searchbox', { name: 'Поисковый запрос' })).not.toBeInViewport()
    await expect(page.getByRole('button', { name: 'Назад' })).toBeInViewport()
    await expect(page.getByRole('button', { name: /^Фильтры/ })).toBeInViewport()
    await expect(page).toHaveScreenshot('list-scrolled-safe-area-dark-ru.png')
  })

  // A release qBittorrent has: its card opens the torrent in place of adding it (#375).
  test('a release already in downloads', async ({ page }) => {
    await openReleases(page, TOP_IN_DOWNLOADS)
    await expect(page.getByRole('link', { name: 'В загрузках' })).toBeVisible()
    await expect(page).toHaveScreenshot('in-downloads-dark-ru.png')
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

  // Counts under a minimum of seeds, with a value that would leave none dimmed (#583).
  test('filters sheet, a value that would leave none', async ({ page }) => {
    await openReleases(page)
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await page.getByRole('button', { name: /^100\+ \d+$/ }).click()
    await expect(page.getByRole('button', { name: '720p 0' })).toBeVisible()
    await expect(page).toHaveScreenshot('filters-dim-dark-ru.png')
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

  test('freeing up space for a release', async ({ page }) => {
    await freeUpSpace(page, async () => {
      await openReleases(page, TO_FREE_UP)
      await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    })
    await expect(page).toHaveScreenshot('add-free-up-dark-ru.png')
  })

  // qBittorrent has the torrent already: the sheet says so and opens it in place of Download (#375).
  test('adding a release already in downloads', async ({ page }) => {
    const inDownloads = torrent(shogunInfoHash(), { name: RELEASES[0].title, progress: 0.4 })
    await openReleases(page, { torrents: [inDownloads] })
    await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    await expect(page.getByText('Уже в загрузках')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Подробности' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('add-already-added-dark-ru.png')
  })

  test('adding a movie, its files named for a media server', async ({ page }) => {
    const dune = { ...RELEASES[1], title: 'Dune.Part.Two.2024.2160p.WEB-DL-GRPA', size: 19.9 * GB, download: 'dune' }
    await openApp(page, '/title/movie/693134/releases', { releases: [dune], movieTorrent: true })
    await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    await page.getByRole('button', { name: 'Параметры' }).click()
    const names = page.getByRole('switch', { name: 'Назвать файлы для медиасервера' })
    await names.click()
    await expect(names).toBeChecked()
    await settle(page)
    await expect(page).toHaveScreenshot('add-movie-names-dark-ru.png')
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
    await expectActionColumnAt(page.getByRole('table').getByRole('button', { name: 'Добавить' }).first())
    await expect(page).toHaveScreenshot('desktop-list-dark-ru.png')
  })

  test('remembered filters, one set aside', async ({ page }) => {
    await findReleases(page, { releaseFilters: REMEMBERED })
    await expect(page.getByText('Запомненные фильтры не применены: Дубляж')).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-remembered-dark-ru.png')
  })

  // A release qBittorrent has: its row opens the torrent in place of adding it (#375).
  test('a release already in downloads', async ({ page }) => {
    await findReleases(page, TOP_IN_DOWNLOADS)
    await expect(page.getByRole('table').getByRole('link', { name: 'В загрузках' })).toBeVisible()
    await expectActionsInTheirCells(page, TOP_IN_DOWNLOADS.releases!.length)
    await expectActionColumnAt(page.getByRole('table').getByRole('link', { name: 'В загрузках' }))
    await expectActionColumnAt(page.getByRole('table').getByRole('button', { name: 'Добавить' }).first())
    await expect(page).toHaveScreenshot('desktop-in-downloads-dark-ru.png')
  })

  test('freeing up space for a release', async ({ page }) => {
    await freeUpSpace(page, async () => {
      await findReleases(page, TO_FREE_UP)
      await page.getByRole('table').getByRole('button', { name: 'Добавить' }).first().click()
    })
    await expect(page).toHaveScreenshot('desktop-add-free-up-dark-ru.png')
  })

  // While the search runs: the filter bar there from the start, its filters as skeletons, the sort working.
  test('searching', async ({ page }) => {
    await openApp(page, '/title/tv/126308')
    // Never answered, so the search stays in flight.
    await page.route((url) => url.pathname === '/prowlarr/search', () => {})
    await page.getByRole('button', { name: 'Найти раздачи' }).click()
    await expect(page.locator('.title-rel-bar .rel-chip-skel').first()).toBeVisible()
    // Off the button just pressed, so it doesn't show its hover state.
    await page.mouse.move(0, 0)
    await settle(page)
    // The skeleton has no roles to find it by (aria-hidden): its action placeholder by its class.
    await expectActionColumnAt(page.locator('.title-rel-skel-action').first())
    await expect(page).toHaveScreenshot('desktop-searching-dark-ru.png')
  })

  // Nothing found: the bar's room kept, empty, over the empty state, so it doesn't move up (#393).
  test('nothing found', async ({ page }) => {
    await openApp(page, '/title/tv/126308', { noReleases: true })
    await page.getByRole('button', { name: 'Найти раздачи' }).click()
    await expect(page.getByRole('heading', { name: 'Раздачи не найдены' })).toBeVisible()
    // Off the button just pressed, so it doesn't show its hover state.
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-none-dark-ru.png')
  })

  // Nothing found, and indexers that didn't answer: the note under the empty state's action (#401).
  test('nothing found, some indexers didn’t answer', async ({ page }) => {
    await openApp(page, '/title/tv/126308', { noReleases: true, failingIndexers: ['Indexer C', 'Indexer D'] })
    await page.getByRole('button', { name: 'Найти раздачи' }).click()
    await expect(page.getByRole('heading', { name: 'Раздачи не найдены' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('2 индексатора не ответили: Indexer C, Indexer D')
    // Off the button just pressed, so it doesn't show its hover state.
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-failing-indexers-none-dark-ru.png')
  })

  // The count's line beside the heading, as it comes; then the names under it on a tap.
  test('some indexers didn’t answer, named', async ({ page }) => {
    await findReleases(page, { failingIndexers: ['Indexer C', 'Indexer D'] })
    const failed = page.getByRole('button', { name: '2 индексатора не ответили' })
    await expect(failed).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-failing-indexers-collapsed-dark-ru.png')
    await failed.click()
    await expect(page.getByText('Indexer C, Indexer D')).toBeVisible()
    // Off the button just pressed, so it doesn't show its hover color.
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

  // The heading's row at its fullest at the narrowest desktop: the heading, the count with the
  // indexers that didn't answer, and the sort, on one line (#400).
  test('some indexers didn’t answer', async ({ page }) => {
    await findReleases(page, { failingIndexers: ['Indexer C', 'Indexer D'] })
    await expect(page.getByRole('button', { name: '2 индексатора не ответили' })).toBeVisible()
    await expect(page).toHaveScreenshot('rail-failing-indexers-dark-ru.png')
  })

  // The names open under the count's line: the button just pressed, the heading and the sort stay
  // where they are, the names growing down.
  test('the count’s line keeps its place as the names open', async ({ page }) => {
    await findReleases(page, { failingIndexers: ['Indexer C', 'Indexer D', 'Indexer E', 'Indexer F', 'Indexer G', 'Indexer H'] })
    const failed = page.getByRole('button', { name: '6 индексаторов не ответили' })
    const heading = page.getByRole('heading', { name: 'Раздачи', exact: true })
    const sort = page.getByRole('radiogroup', { name: 'Сортировка' })
    const tops = async () => [(await failed.boundingBox())?.y, (await heading.boundingBox())?.y, (await sort.boundingBox())?.y]
    const before = await tops()
    await failed.click()
    await expect(page.getByText('Indexer C, Indexer D')).toBeVisible()
    expect(await tops()).toEqual(before)
  })
})
