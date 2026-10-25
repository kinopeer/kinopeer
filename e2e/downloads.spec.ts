import { expect, test, type Page } from '@playwright/test'
import { openApp, settle, showWholePage, type AppOptions } from './app.ts'
import { TITLES } from './fixtures.ts'

/** The titles of the tagged fixture torrents, in the given language. */
const titles = (lang: 'ru' | 'en') => TITLES.slice(0, 8).map((title) => title[lang])

async function openDownloads(page: Page, options: AppOptions = {}) {
  await openApp(page, '/', options)
  const lang = options.lang ?? 'ru'
  for (const title of titles(lang)) await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  await settle(page)
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

  test('actions sheet from the grid', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('grid-actions-dark-ru.png')
  })

  test('sort and filter sheet', async ({ page }) => {
    await openDownloads(page)
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    // The radio itself is visually hidden; a tap lands on its row.
    await page.getByRole('dialog').getByText('Размер', { exact: true }).click()
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

    test('poster grid', async ({ page }) => {
      await openDownloads(page, { theme: 'light', lang: 'en', downloadsView: 'grid' })
      await showWholePage(page)
      await expect(page).toHaveScreenshot('grid-light-en.png')
    })
  })
})

test.describe('downloads, wide screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('poster grid, dark, Russian', async ({ page }) => {
    await openDownloads(page, { downloadsView: 'grid' })
    await showWholePage(page)
    await expect(page).toHaveScreenshot('grid-wide-dark-ru.png')
  })
})
