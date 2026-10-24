import { expect, test } from '@playwright/test'
import { openApp, settle, showWholePage } from './app.ts'
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
