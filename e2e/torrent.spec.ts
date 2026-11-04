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
  await expect(page.getByText('Подобрано по имени раздачи. Всё верно?')).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('guess-dark-ru.png')
})

test('changing the title, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/b1', { torrents: [...TORRENTS, GUESSED] })
  await page.getByRole('button', { name: 'Изменить' }).click()
  const sheet = page.getByRole('dialog', { name: 'Сменить фильм или сериал' })
  await expect(sheet.getByRole('button', { name: /^Начало/ })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('change-title-dark-ru.png')
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
