import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, DESKTOP_RAIL, openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { keyboardArea } from '../src/lib/keyboardInset.ts'
import { TITLES } from './fixtures.ts'

/** The titles of the tagged fixture torrents, in the given language. */
const titles = (lang: 'ru' | 'en') => TITLES.slice(0, 8).map((title) => title[lang])

async function openDownloads(page: Page, options: AppOptions = {}) {
  await openApp(page, '/', options)
  const lang = options.lang ?? 'ru'
  for (const title of titles(lang)) await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  await settle(page)
}

/** Chromium's own safe area is empty: this gives env(safe-area-inset-top) a notched iPhone's. */
async function emulateNotch(page: Page) {
  const devTools = await page.context().newCDPSession(page)
  await devTools.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59 } })
}

/**
 * Sets what trackKeyboardInset sets while the on-screen keyboard is open (Chromium has none to open),
 * by its own rule: the page visible above it, `top` pixels down the layout viewport when the
 * browser scrolled to show the field.
 */
async function openKeyboard(page: Page, { height, top = 0 }: { height: number; top?: number }) {
  const layoutHeight = page.viewportSize()!.height
  const area = keyboardArea({ layoutHeight, height, offsetTop: top, scale: 1 })!
  await page.evaluate((area) => {
    const style = document.documentElement.style
    style.setProperty('--keyboard-inset', `${area.inset}px`)
    style.setProperty('--visible-top', `${area.top}px`)
    style.setProperty('--visible-height', `${area.height}px`)
    style.setProperty('--keyboard-open', '1')
  }, area)
}

test.describe('downloads, phone', () => {
  test('list, dark, Russian', async ({ page }) => {
    await openDownloads(page)
    await showWholePage(page)
    await expect(page).toHaveScreenshot('list-dark-ru.png')
  })

  test('poster grid, dark, Russian', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await showWholePage(page)
    await expect(page).toHaveScreenshot('grid-dark-ru.png')
  })

  test('alternative speed limits on', async ({ page }) => {
    await openDownloads(page, { altSpeedLimits: true })
    await expect(page.getByRole('button', { name: 'Альтернативные лимиты скорости', pressed: true })).toBeVisible()
    await expect(page).toHaveScreenshot('alt-speed-on-dark-ru.png')
  })

  test('actions sheet from the grid', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // The sheet opens under the pointer that opened it, which would hover one of its rows.
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('grid-actions-dark-ru.png')
  })

  test('the actions sheet closes when dragged down by its poster', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await settle(page)
    // A mouse on an image starts the browser's own drag, which jsdom doesn't have. The poster is
    // decorative (no name), so it's found by its class.
    const poster = sheet.locator('.actions-poster img')
    const box = await poster.boundingBox()
    if (!box) throw new Error('The sheet has no poster')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 10 })
    await page.mouse.up()
    await expect(sheet).toBeHidden()
  })

  test('speed limits sheet from the actions sheet', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await page.getByRole('button', { name: 'Лимиты скорости', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Лимиты скорости' })
    // One field with a limit and one left empty, so both states show.
    const download = sheet.getByRole('textbox', { name: 'Лимит загрузки, МБ/с' })
    await download.fill('2,5')
    await download.blur()
    await settle(page)
    await expect(page).toHaveScreenshot('speed-limits-dark-ru.png')
  })

  test('speed limits sheet above the on-screen keyboard', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await page.getByRole('button', { name: 'Лимиты скорости', exact: true }).click()
    await openKeyboard(page, { height: 508 })
    await settle(page)
    await expect(page).toHaveScreenshot('speed-limits-keyboard-dark-ru.png')
  })

  test('a tall sheet within the page left above the keyboard, scrolled to its field', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await page.getByRole('button', { name: 'Перенести файлы…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Перенести файлы' })
    await expect(sheet.getByRole('group', { name: 'Папки qBittorrent' })).toBeVisible()
    await openKeyboard(page, { height: 508, top: 120 })
    await settle(page)
    await expect(page).toHaveScreenshot('move-keyboard-dark-ru.png')
  })

  test('moving the files', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await page.getByRole('button', { name: 'Перенести файлы…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Перенести файлы' })
    await expect(sheet.getByRole('group', { name: 'Папки qBittorrent' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('move-dark-ru.png')
  })

  test('sort and filter sheet', async ({ page }) => {
    await openDownloads(page)
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // The radio itself is visually hidden, so the click goes to its row, which waits for the sheet
    // to finish sliding up; a forced click on the radio took its position from the first frame.
    await sheet.getByText('Размер', { exact: true }).click()
    await expect(page.getByRole('radio', { name: 'Размер' })).toBeChecked()
    await page.getByRole('radio', { name: 'Сериалы' }).click()
    await settle(page)
    await expect(page).toHaveScreenshot('sort-dark-ru.png')
  })

  test('series only, with the type badge', async ({ page }) => {
    await openDownloads(page)
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    await page.getByRole('radio', { name: 'Сериалы' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click()
    await expect(page.getByRole('button', { name: 'Сортировка: Приоритет, Сериалы' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('series-dark-ru.png')
  })

  test('selection in the list', async ({ page }) => {
    await openDownloads(page)
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
    for (const title of titles('ru').slice(0, 2)) await page.getByRole('checkbox', { name: title }).first().click()
    await expect(page.getByRole('toolbar', { name: 'Выбрано: 2' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('select-list-dark-ru.png')
  })

  test('selection in the poster grid', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
    await page.getByRole('checkbox', { name: titles('ru')[0] }).first().click()
    await expect(page.getByRole('toolbar', { name: 'Выбрано: 1' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('select-grid-dark-ru.png')
  })

  test('the filters stay at the top while the list scrolls', async ({ page }) => {
    await openDownloads(page)
    await page.evaluate(() => window.scrollTo(0, 600))
    // The title and the totals scroll away; the bar with the filters, the sort and the view is pinned.
    await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).not.toBeInViewport()
    await expect(page.getByRole('group', { name: 'Фильтр по статусу' })).toBeInViewport()
    await expect(page).toHaveScreenshot('list-scrolled-dark-ru.png')
  })

  test('the list stays out of the status bar above the pinned filters', async ({ page }) => {
    await emulateNotch(page)
    await openDownloads(page, { downloadsView: 'grid' })
    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
    await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).not.toBeInViewport()
    await expect(page).toHaveScreenshot('grid-scrolled-safe-area-dark-ru.png')
  })

  test('nothing downloaded yet', async ({ page }) => {
    await openApp(page, '/', { torrents: [] })
    await expect(page.getByText('Загрузок пока нет')).toBeVisible()
    await expect(page).toHaveScreenshot('empty-dark-ru.png')
  })

  test('qBittorrent stops answering', async ({ page }) => {
    await openDownloads(page, { goesOffline: true })
    await expect(page.getByText('Нет связи с qBittorrent')).toBeVisible()
    await expect(page).toHaveScreenshot('offline-dark-ru.png')
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('list', async ({ page }) => {
      await openDownloads(page, { theme: 'light', lang: 'en' })
      await showWholePage(page)
      await expect(page).toHaveScreenshot('list-light-en.png')
    })
  })
})

test.describe('downloads, tablet', () => {
  // Below the desktop breakpoint a wide screen keeps the phone layout in a centered column, with
  // the tab bar's tabs over it.
  test.use({ viewport: { width: 768, height: 1024 } })

  test('list in a centered column, dark, Russian', async ({ page }) => {
    await openDownloads(page)
    await showWholePage(page)
    await expect(page).toHaveScreenshot('tablet-list-dark-ru.png')
  })
})

test.describe('downloads, desktop', () => {
  test.use(DESKTOP)

  test('poster grid by default, dark, Russian', async ({ page }) => {
    await openDownloads(page)
    // The sidebar's card loads the version with its own request, after the list has its titles.
    await expect(page.getByRole('region', { name: 'qBittorrent' })).toContainText('qBittorrent 5.3.0')
    await expect(page).toHaveScreenshot('desktop-grid-dark-ru.png')
  })

  test('list as a table, dark, Russian', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await expect(page.getByRole('table', { name: 'Загрузки' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-list-dark-ru.png')
  })

  test('alternative speed limits on, in the sidebar’s card', async ({ page }) => {
    await openDownloads(page, { altSpeedLimits: true })
    const card = page.getByRole('region', { name: 'qBittorrent' })
    await expect(card.getByRole('button', { name: 'Альт. лимиты', pressed: true })).toBeVisible()
    await expect(card).toHaveScreenshot('desktop-alt-speed-on-dark-ru.png')
  })

  test('the header takes the safe area once, with no strip above it', async ({ page }) => {
    await emulateNotch(page)
    await openDownloads(page, { downloadsView: 'grid' })
    await expect(page).toHaveScreenshot('desktop-grid-safe-area-dark-ru.png')
  })

  test('the header and the column names stay at the top while the table scrolls', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    // As far as the page goes: the first rows pass under the header and the column names.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeInViewport()
    await expect(page.getByRole('columnheader', { name: 'Название' })).toBeInViewport()
    await expect(page).toHaveScreenshot('desktop-list-scrolled-dark-ru.png')
  })

  test('a row’s actions as a menu', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-menu-dark-ru.png')
  })

  test('the sort menu and series only', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('radio', { name: 'Сериалы' }).click()
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Приоритет' })).toHaveAttribute('aria-checked', 'true')
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-sort-dark-ru.png')
  })

  test('selection beside the sidebar', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
    await page.getByRole('checkbox', { name: titles('ru')[0] }).first().click()
    await expect(page.getByRole('toolbar', { name: 'Выбрано: 1' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-select-dark-ru.png')
  })

  // Where the row's overlay link lies is CSS, which only the browser sees: a click on the status
  // chip, away from the title, selects the row while selecting and opens its details otherwise.
  test('the row’s overlay takes a click away from the title', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    const row = () => page.getByRole('row').filter({ hasText: 'Оппенгеймер' })
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
    const onStatus = async () => {
      const chip = await row().getByText('Пауза').boundingBox()
      const box = await row().boundingBox()
      await row().click({ position: { x: chip!.x - box!.x + 10, y: chip!.y - box!.y + 8 } })
    }
    await onStatus()
    await expect(page.getByRole('checkbox', { name: 'Оппенгеймер' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Отмена' }).click()

    await onStatus()
    await expect(page).toHaveURL(/\/torrent\//)
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('qBittorrent stops answering', async ({ page }) => {
    await openDownloads(page, { goesOffline: true })
    await expect(page.getByText('Нет связи с qBittorrent').first()).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-offline-dark-ru.png')
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('poster grid', async ({ page }) => {
      await openDownloads(page, { theme: 'light', lang: 'en' })
      await expect(page).toHaveScreenshot('desktop-grid-light-en.png')
    })
  })
})

test.describe('downloads, narrow desktop', () => {
  test.use(DESKTOP_RAIL)

  test('a modal centered above the on-screen keyboard', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await page.getByRole('menuitem', { name: 'Лимиты скорости' }).click()
    await expect(page.getByRole('dialog', { name: 'Лимиты скорости' })).toBeVisible()
    await openKeyboard(page, { height: 420 })
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-speed-limits-keyboard-dark-ru.png')
  })

  test('alternative speed limits on, in the rail', async ({ page }) => {
    await openDownloads(page, { altSpeedLimits: true })
    const status = page.getByRole('region', { name: 'qBittorrent' })
    await expect(status.getByRole('button', { name: 'Альтернативные лимиты скорости', pressed: true })).toBeVisible()
    await expect(status).toHaveScreenshot('rail-alt-speed-on-dark-ru.png')
  })

  test('the status menu, with errors hidden by the picked status', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('button', { name: /^Статус: Все/ }).click()
    await page.getByRole('menuitemradio', { name: /^Раздаётся/ }).click()
    await page.getByRole('button', { name: /^Статус: Раздаётся/ }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('rail-status-dark-ru.png')
  })
})

test.describe('downloads, full HD', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('the table with its size column', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await expect(page.getByRole('columnheader', { name: 'Размер' })).toBeVisible()
    await expect(page).toHaveScreenshot('full-hd-list-dark-ru.png')
  })

  // Every other shot is in the queue order, ascending: this one shows a column's sort descending, in
  // the header and on the sort button's icon.
  test('sorted by a column’s header', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await page.getByRole('button', { name: 'Размер' }).click()
    await expect(page.getByRole('columnheader', { name: 'Размер' })).toHaveAttribute('aria-sort', 'descending')
    await page.mouse.move(0, 0)
    await settle(page)
    await expect(page).toHaveScreenshot('full-hd-sorted-dark-ru.png')
  })
})

test.describe('downloads, labelled sidebar at its narrowest', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('the table keeps room for the title', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'list' })
    await expect(page.getByRole('columnheader', { name: 'Осталось' })).toBeHidden()
    await expect(page).toHaveScreenshot('labelled-list-dark-ru.png')
  })
})

// The scroll lock is for touch screens (pointer: coarse), which hasTouch makes this Chromium one.
test.describe('downloads, phone with a touch screen', () => {
  test.use({ hasTouch: true })

  // This Chromium runs with reduced motion, where base.css gives everything a 1 ms transition. A
  // margin on <body> still on its way back would shorten the page under the scroll back.
  test('the list comes back to its end once a sheet with a field is closed', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    const end = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      return window.scrollY
    })
    expect(end).toBeGreaterThan(0)
    await settle(page)

    await page.getByRole('button', { name: /^Ещё действия:/ }).last().click()
    await page.getByRole('button', { name: 'Перенести файлы…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Перенести файлы' })
    await expect(sheet).toBeVisible()
    // The pin's own transition over, or how soon Escape comes decides what this test can see.
    await page.waitForFunction(() => document.body.getAnimations().length === 0)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(end)
  })

  test('the sort sheet closes when dragged down by its top, and the list behind it stays put', async ({ page }) => {
    await openDownloads(page)
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    const sheet = page.getByRole('dialog', { name: 'Сортировка и фильтр' })
    await expect(sheet).toBeVisible()
    await settle(page)
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 600)).toBe(true)

    // A wheel over the backdrop stands in for a finger: both scrolled the page under a modal <dialog>.
    // What it did shows below, once the sheet is closed.
    await page.mouse.move(195, 40)
    await page.mouse.wheel(0, 600)

    // Sheet.test.tsx owns when a drag closes the sheet; this sees what jsdom can't: the real <dialog>
    // and pointer capture keeping the moves on the title once the pointer leaves it. A mouse sends no
    // touch input, so touch-action stays with the real-phone blind spot.
    const title = sheet.getByRole('heading', { name: 'Сортировка и фильтр' })
    const box = await title.boundingBox()
    if (!box) throw new Error('The sheet has no title')
    await page.mouse.move(box.x + 10, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 10, box.y + 300, { steps: 10 })
    await page.mouse.up()
    await expect(sheet).toBeHidden()

    // A shorter wheel now scrolls the page by just that much, so the first one under the sheet did
    // nothing (it would have left the page at 600 or more), and this one being handled means that one
    // was too.
    await page.mouse.wheel(0, 200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200)
  })
})
