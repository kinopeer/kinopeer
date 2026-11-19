import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { DESKTOP, DESKTOP_RAIL, openApp, settle, showWholePage, type AppOptions } from './app.ts'

// Masked, so a version bump doesn't change the screenshots.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const versionValue = (page: Page) => page.getByText(version, { exact: true })

async function openSettings(page: Page, options: AppOptions = {}, connected = 3) {
  await openApp(page, '/settings', options)
  // Every connection check has answered.
  await expect(page.getByRole('status').filter({ hasText: /^Подключено/ })).toHaveCount(connected)
  // The categories, asked once qBittorrent's check passes.
  await expect(page.getByRole('combobox', { name: 'Категория фильмов' })).toBeEnabled()
  await showWholePage(page)
}

test('dark, Russian', async ({ page }) => {
  await openSettings(page)
  await expect(page).toHaveScreenshot('settings-dark-ru.png', { mask: [versionValue(page)] })
})

test('a connection with an error, dark, Russian', async ({ page }) => {
  await openSettings(page, { prowlarrDown: true }, 2)
  await expect(page.getByText('Prowlarr не отвечает')).toBeVisible()
  await expect(page).toHaveScreenshot('settings-error-dark-ru.png', { mask: [versionValue(page)] })
})

test('Prowlarr without indexers, dark, Russian', async ({ page }) => {
  await openSettings(page, { prowlarrIndexers: 0 })
  await expect(page.getByText('Подключено · нет индексаторов')).toBeVisible()
  await expect(page).toHaveScreenshot('settings-no-indexers-dark-ru.png', { mask: [versionValue(page)] })
})

test('with Kinopeer’s own login, dark, Russian', async ({ page }) => {
  await openSettings(page, { auth: { enabled: true, source: 'saved' } })
  await expect(page.getByRole('region', { name: 'Вход' })).toBeVisible()
  await expect(page).toHaveScreenshot('settings-sign-in-dark-ru.png', { mask: [versionValue(page)] })
})

test('changing the password, dark, Russian', async ({ page }) => {
  await openApp(page, '/settings', { auth: { enabled: true, source: 'saved' } })
  await page.getByRole('button', { name: /Сменить пароль/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Сменить пароль' })
  await expect(sheet.getByLabel('Текущий пароль')).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('change-password-dark-ru.png')
})

const BOT = 'kinopeer_home_bot'
const CONNECTED = { bot: BOT, chat: { name: 'Alex', type: 'private' as const }, refused: null }

test('Telegram notifications connected, dark, Russian', async ({ page }) => {
  await openSettings(page, { telegram: CONNECTED })
  await expect(page.getByText('Отправляет в «Alex» от @kinopeer_home_bot')).toBeVisible()
  await expect(page).toHaveScreenshot('settings-telegram-dark-ru.png', { mask: [versionValue(page)] })
})

test('setting up Telegram: the bot’s token, dark, Russian', async ({ page }) => {
  await openApp(page, '/settings', { telegram: { bot: null, chat: null, refused: null } })
  await page.getByRole('button', { name: 'Настроить' }).click()
  await expect(page.getByRole('dialog', { name: 'Уведомления в Telegram' }).getByLabel('Токен бота')).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('telegram-token-dark-ru.png')
})

test('setting up Telegram: the chat that sent /start, before it’s saved, dark, Russian', async ({ page }) => {
  await openApp(page, '/settings', {
    telegram: { bot: BOT, chat: null, refused: null, found: { id: 42, name: 'Alex', type: 'private' } },
  })
  await page.getByRole('button', { name: 'Изменить уведомления в Telegram' }).click()
  const sheet = page.getByRole('dialog', { name: 'Уведомления в Telegram' })
  await sheet.getByRole('button', { name: 'Найти чат' }).click()
  await expect(sheet.getByRole('group', { name: 'Это нужный чат?' })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('telegram-chat-dark-ru.png')
})

test('Telegram connected, the chat refused the last message, dark, Russian', async ({ page }) => {
  await openApp(page, '/settings', { telegram: { ...CONNECTED, refused: 'chat' } })
  await page.getByRole('button', { name: 'Изменить уведомления в Telegram' }).click()
  const sheet = page.getByRole('dialog', { name: 'Уведомления в Telegram' })
  await expect(sheet.getByRole('button', { name: 'Отправить тестовое сообщение' })).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('telegram-connected-dark-ru.png')
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('with a password from KINOPEER_PASSWORD, dark, Russian', async ({ page }) => {
    await openSettings(page, { auth: { enabled: true, source: 'env' } })
    await expect(page.getByText(/Пароль задан на сервере/)).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-sign-in-env-dark-ru.png', { mask: [versionValue(page)] })
  })

  test('changing the password, dark, Russian', async ({ page }) => {
    await openApp(page, '/settings', { auth: { enabled: true, source: 'saved' } })
    await page.getByRole('button', { name: /Сменить пароль/ }).click()
    await expect(page.getByRole('dialog', { name: 'Сменить пароль' }).getByLabel('Текущий пароль')).toBeVisible()
    await settle(page)
    // Behind the scrim, but in the picture.
    await expect(page).toHaveScreenshot('desktop-change-password-dark-ru.png', { mask: [versionValue(page)] })
  })

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('desktop-dark-ru.png', { mask: [versionValue(page)] })
  })
})

test.describe('desktop rail', () => {
  test.use(DESKTOP_RAIL)

  test('dark, Russian', async ({ page }) => {
    await openSettings(page)
    await expect(page).toHaveScreenshot('rail-dark-ru.png', { mask: [versionValue(page)] })
  })
})
