import { expect, test } from '@playwright/test'
import { DESKTOP, openApp, settle, showWholePage } from './app.ts'
import { GUESSED, TORRENTS } from './fixtures.ts'

test('downloading series with its files, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/a2')
  await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()
  await page.getByRole('button', { name: 'Файлы' }).click()
  await page.getByRole('button', { name: /^Episodes/ }).click()
  await expect(page.getByText(/Shogun\.S01E01/)).toBeVisible()
  await showWholePage(page)
  await expect(page).toHaveScreenshot('series-dark-ru.png')
})

test('title guessed from the release name, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/b1', { torrents: [...TORRENTS, GUESSED] })
  await expect(page.getByRole('heading', { level: 1, name: 'Начало' })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('guess-dark-ru.png')
})

test('no title found, the poster a button that matches one, dark, Russian', async ({ page }) => {
  // TMDB finds nothing for its name.
  await openApp(page, '/torrent/a9')
  await expect(page.getByRole('button', { name: 'Сопоставить' })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('no-title-dark-ru.png')
})

test('fixing the match, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/b1', { torrents: [...TORRENTS, GUESSED] })
  await page.getByRole('button', { name: 'Ещё действия: Начало' }).click()
  await page.getByRole('dialog', { name: 'Начало' }).getByRole('button', { name: 'Исправить сопоставление' }).click()
  const sheet = page.getByRole('dialog', { name: 'Исправить сопоставление' })
  await expect(sheet.getByRole('button', { name: /^Начало/ })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('change-title-dark-ru.png')
})

test('changing the category, which moves the files, dark, Russian', async ({ page }) => {
  // Under automatic management, so the sheet shows where each category would move the files.
  const torrents = TORRENTS.map((item) => (item.hash === 'a2' ? { ...item, auto_tmm: true } : item))
  await openApp(page, '/torrent/a2', { torrents })
  await page.getByRole('button', { name: 'Категория: TV Shows' }).click()
  const sheet = page.getByRole('dialog', { name: 'Категория' })
  await sheet.getByText('Movies', { exact: true }).click()
  await expect(sheet.getByText('qBittorrent перенесёт файлы в /downloads/movies.')).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('category-dark-ru.png')
})

test('missing files, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/a8')
  await expect(page.getByRole('heading', { level: 1, name: 'Во все тяжкие' })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('error-dark-ru.png')
})

test.describe('desktop drawer', () => {
  test.use(DESKTOP)

  test('over Downloads, dark, Russian', async ({ page }) => {
    await openApp(page, '/torrent/a2')
    const drawer = page.getByRole('dialog', { name: 'Сёгун' })
    await expect(drawer.getByRole('heading', { level: 2, name: 'Сёгун' })).toBeVisible()
    await drawer.getByRole('button', { name: 'Файлы' }).click()
    await drawer.getByRole('button', { name: /^Episodes/ }).click()
    await expect(drawer.getByText(/Shogun\.S01E01/)).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-drawer-dark-ru.png')
  })

  test('no title found, the poster a button that matches one, dark, Russian', async ({ page }) => {
    await openApp(page, '/')
    // Every other torrent's title and poster are in, so the page behind looks the same every run.
    await expect(page.locator('.ks-poster-none')).toHaveCount(1)
    await page.getByRole('link', { name: /Unknown\.Nature/ }).click()
    const drawer = page.getByRole('dialog', { name: /^Unknown\.Nature/ })
    await expect(drawer.getByRole('button', { name: 'Сопоставить' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-drawer-no-title-dark-ru.png')
  })

  test('over the title page it was opened from, back to it on Escape, dark, Russian', async ({ page }) => {
    await openApp(page, '/title/movie/693134')
    await expect(page.getByRole('heading', { level: 1, name: 'Дюна: Часть вторая' })).toBeVisible()
    const card = page.getByRole('region', { name: /^В загрузках/ }).getByRole('link').first()
    await card.click()
    const drawer = page.getByRole('dialog', { name: 'Дюна: Часть вторая' })
    await expect(drawer.getByRole('heading', { level: 2, name: 'Дюна: Часть вторая' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-drawer-over-title-dark-ru.png')

    // A real Escape on a native <dialog>, which jsdom only simulates.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/title\/movie\/693134$/)
    await expect(card).toBeFocused()
  })
})
