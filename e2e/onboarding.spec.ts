import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { BRIDGE_HEADERS, DESKTOP, openApp, settle, type AppOptions } from './app.ts'

/** The server's settings for a step: the environment's addresses, the TMDB key missing for its step, nothing for a fresh install. */
function settingsFor(step: 'tmdb' | 'address' | 'prowlarr') {
  const none = { source: null }
  return {
    tmdb: { configured: step !== 'tmdb', source: step === 'tmdb' ? null : 'saved', fallback: null },
    prowlarr:
      step === 'tmdb'
        ? { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }
        : { configured: false, source: null, serverKey: false, address: none },
    qbittorrent: { configured: true, source: 'saved', address: step === 'tmdb' ? { source: 'env' } : none },
    downloads: null,
    // Beyond Umbrel, where the app saves addresses: behind Kinopeer's own login.
    auth: step === 'tmdb' ? { enabled: false } : { enabled: true, source: 'saved' },
  }
}

/** Opens the app, then answers as a fresh install would and reloads, so the given setup step shows. */
async function openOnboarding(page: Page, step: 'connect' | 'tmdb' | 'address' | 'prowlarr', options: AppOptions = {}) {
  await openApp(page, '/', options)
  // Routes added later take precedence over the app's mocks.
  if (step === 'connect') {
    await page.route(
      (url) => url.pathname === '/qbt/api/v2/app/version',
      (route) => route.fulfill({ status: 403, headers: BRIDGE_HEADERS, body: 'Forbidden' }),
    )
  } else {
    await page.route(
      (url) => url.pathname === '/api/settings',
      (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(settingsFor(step)) }),
    )
  }
  if (step === 'address') {
    // The bridge's mark when it has no address (server/qbittorrent.ts), written out as BRIDGE_HEADERS is.
    await page.route(
      (url) => url.pathname === '/qbt/api/v2/app/version',
      (route) => route.fulfill({ status: 503, headers: { 'x-kinopeer-bridge': 'no-address' }, body: 'qBittorrent has no address' }),
    )
  }
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await settle(page)
}

test.describe('onboarding, desktop', () => {
  test.use(DESKTOP)

  test('connect to qBittorrent, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'connect')
    await expect(page.getByRole('button', { name: 'Подключить' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-connect-dark-ru.png')
  })

  // #357: no address on the server, beyond Umbrel: the form asks for one.
  test('qBittorrent’s address, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'address')
    await expect(page.getByRole('textbox', { name: 'Адрес qBittorrent' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-connect-address-dark-ru.png')
  })

  // #357: Prowlarr's address and key, after qBittorrent connects.
  test('Prowlarr, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'prowlarr')
    await expect(page.getByRole('textbox', { name: 'Адрес Prowlarr' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-prowlarr-dark-ru.png')
  })

  test('TMDB key, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'tmdb')
    await expect(page.getByRole('textbox', { name: 'Ключ API или токен доступа' })).toBeVisible()
    await expect(page).toHaveScreenshot('desktop-tmdb-key-dark-ru.png')
  })

  // #359: qBittorrent too old, the state in the form's card.
  test('qBittorrent too old, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { qbittorrentVersion: '4.5.5' })
    await expect(page.getByRole('heading', { name: 'qBittorrent 4.5.5 слишком старый' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-unsupported-dark-ru.png')
  })

  // #357: an address saved from the app can be changed there, under the state in the card.
  test('qBittorrent too old at an address saved from the app, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { qbittorrentVersion: '4.5.5', auth: { enabled: true, source: 'saved' }, addressesFromApp: true })
    await expect(page.getByRole('button', { name: 'Изменить адрес qBittorrent' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-unsupported-address-dark-ru.png')
  })

  // #311: the session check got no answer: the state in the form's card, in place of the form.
  test('Kinopeer doesn’t answer the session check, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { serviceWorkerAnswers: true, sessionUnreached: true })
    await expect(page.getByRole('heading', { name: 'Kinopeer не отвечает' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-connect-unreached-dark-ru.png')
  })
})

test.describe('onboarding, phone', () => {
  // #311: the session check got no answer: the state in place of the form, with Retry and Open again.
  test('Kinopeer doesn’t answer the session check, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { serviceWorkerAnswers: true, sessionUnreached: true })
    await expect(page.getByRole('heading', { name: 'Kinopeer не отвечает' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть заново' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('connect-unreached-dark-ru.png')
  })

  // #359: qBittorrent answers, but it's older than Kinopeer works with.
  test('qBittorrent too old, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { qbittorrentVersion: '4.5.5' })
    await expect(page.getByRole('heading', { name: 'qBittorrent 4.5.5 слишком старый' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('unsupported-dark-ru.png')
  })

  // #357: an address saved from the app can be changed there, under the state.
  test('qBittorrent too old at an address saved from the app, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { qbittorrentVersion: '4.5.5', auth: { enabled: true, source: 'saved' }, addressesFromApp: true })
    await expect(page.getByRole('button', { name: 'Изменить адрес qBittorrent' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('unsupported-address-dark-ru.png')
  })

  // #357: no address on the server: the address, and a login only where qBittorrent wants one.
  test('qBittorrent’s address, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'address')
    await expect(page.getByRole('textbox', { name: 'Адрес qBittorrent' })).toBeVisible()
    await expect(page).toHaveScreenshot('connect-address-dark-ru.png')
  })

  test('Prowlarr, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'prowlarr')
    await expect(page.getByRole('textbox', { name: 'Адрес Prowlarr' })).toBeVisible()
    await expect(page).toHaveScreenshot('prowlarr-dark-ru.png')
  })

  test('a wrong password, dark, Russian', async ({ page }) => {
    await openOnboarding(page, 'connect', { wrongLogin: true })
    await page.getByRole('textbox', { name: 'Логин' }).fill('admin')
    await page.getByLabel('Пароль').fill('wrong')
    await page.getByRole('button', { name: 'Подключить' }).click()
    await expect(page.getByText('Неверный логин или пароль')).toBeVisible()
    await expect(page).toHaveScreenshot('connect-invalid-dark-ru.png')
  })
})

test.describe('Kinopeer’s own login, phone', () => {
  test('setting the password, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { signIn: 'set-up' })
    await expect(page.getByRole('heading', { name: 'Задайте пароль' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('set-up-password-dark-ru.png')
  })

  test('signing in, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { signIn: 'sign-in' })
    await expect(page.getByRole('heading', { name: 'Вход в Kinopeer' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('sign-in-dark-ru.png')
  })

  test('a wrong password, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { signIn: 'sign-in' })
    await page.getByLabel('Пароль').fill('wrong password')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByText('Неверный пароль')).toBeVisible()
    // Off the button, which the click left in its hover shade (#287).
    await page.mouse.move(0, 0)
    await expect(page).toHaveScreenshot('sign-in-invalid-dark-ru.png')
  })

  test('too many wrong passwords, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { signIn: 'throttled' })
    await page.getByLabel('Пароль').fill('wrong password')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toHaveText(/Попробуйте через 15 минут/)
    await expect(page).toHaveScreenshot('sign-in-throttled-dark-ru.png')
  })
})

test.describe('Kinopeer’s own login, desktop', () => {
  test.use(DESKTOP)

  test('setting the password, dark, Russian', async ({ page }) => {
    await openApp(page, '/', { signIn: 'set-up' })
    await expect(page.getByRole('heading', { name: 'Задайте пароль' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-set-up-password-dark-ru.png')
  })

  test('signing in, light, English', async ({ page }) => {
    await openApp(page, '/', { signIn: 'sign-in', theme: 'light', lang: 'en' })
    await expect(page.getByRole('heading', { name: 'Sign in to Kinopeer' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-sign-in-light-en.png')
  })
})
