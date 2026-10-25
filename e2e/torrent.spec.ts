import { expect, test } from '@playwright/test'
import { DESKTOP, openApp, settle, showWholePage } from './app.ts'
import { GUESSED, TORRENTS } from './fixtures.ts'

test('downloading series with its files, dark, Russian', async ({ page }) => {
  await openApp(page, '/torrent/a2')
  await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()
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

test.describe('light, English', () => {
  test.use({ locale: 'en-US' })

  test('missing files', async ({ page }) => {
    await openApp(page, '/torrent/a8', { theme: 'light', lang: 'en' })
    await expect(page.getByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('error-light-en.png')
  })
})

test.describe('desktop drawer', () => {
  test.use(DESKTOP)

  test('over Downloads, dark, Russian', async ({ page }) => {
    await openApp(page, '/torrent/a2')
    const drawer = page.getByRole('dialog', { name: 'Сёгун' })
    await expect(drawer.getByRole('heading', { level: 2, name: 'Сёгун' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeAttached()
    await drawer.getByRole('button', { name: /^Episodes/ }).click()
    await expect(drawer.getByText(/Shogun\.S01E01/)).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-drawer-dark-ru.png')
  })

  test('opens from a row and closes on Escape', async ({ page }) => {
    await openApp(page, '/', { downloadsView: 'list' })
    await page.getByRole('link', { name: /^Сёгун/ }).click()
    await expect(page.getByRole('dialog', { name: 'Сёгун' })).toBeVisible()
    await expect(page).toHaveURL(/\/torrent\/a2$/)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: /^Сёгун/ })).toBeFocused()
  })

  test.describe('light, English', () => {
    test.use({ locale: 'en-US' })

    test('a guessed title', async ({ page }) => {
      await openApp(page, '/torrent/b1', { theme: 'light', lang: 'en', torrents: [...TORRENTS, GUESSED] })
      const drawer = page.getByRole('dialog', { name: 'Inception' })
      await expect(drawer.getByText('Matched by the release name. Is it right?')).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot('desktop-drawer-guess-light-en.png')
    })
  })
})
