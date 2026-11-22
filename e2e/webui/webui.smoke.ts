import type { Page } from '@playwright/test'
import { clientData, LOGIN, SEEDED_NAME } from './qbittorrent.ts'
import { expect, test } from './test.ts'

/** The key the first device saves; the fake TMDB takes any. */
const TMDB_KEY = 'webui-smoke-tmdb-key'

async function signIn(page: Page, password = LOGIN.password): Promise<void> {
  await page.getByLabel('Логин').fill(LOGIN.username)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

/** Skips onboarding's Prowlarr step, which every journey meets: no address is kept for it. */
async function skipProwlarr(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите Prowlarr' })).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
}

/**
 * qBittorrent's own login from the page, then Downloads: what only a real qBittorrent shows is that
 * it serves the build as its Alternative WebUI (`/` is Kinopeer's page, not its own interface), that
 * the login from the browser gives the page qBittorrent's session cookie, and that the API calls on
 * the page's own origin carry it, the poll among them, which lists the torrent the stand added.
 */
test('the login, then Downloads', async ({ page, context, tmdbCalls }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Вход в qBittorrent' })).toBeVisible()

  await signIn(page, 'wrong password')
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible()
  await signIn(page)

  // No key of the user's own and no proxy in this build: onboarding asks for TMDB, then Prowlarr.
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите TMDB' })).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await skipProwlarr(page)

  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect(page.getByText(SEEDED_NAME).first()).toBeVisible()

  const session = (await context.cookies()).find((cookie) => cookie.name.startsWith('QBT_SID_'))
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict' })
  // A reload rides on qBittorrent's session: no login form again.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите TMDB' })).toBeVisible()
  // Without a key the page asked TMDB nothing.
  expect(tmdbCalls).toEqual([])
})

/**
 * A setting saved to qBittorrent's `clientdata` and read back on another device: the TMDB key the
 * first browser saves is in qBittorrent under Kinopeer's key, and a second browser, with nothing of
 * the first's in its storage, signs in without being asked for it and calls TMDB with it.
 */
test('the TMDB key saved in qBittorrent, read back by another browser', async ({ page, tmdbCalls, newContext }) => {
  await page.goto('/')
  await signIn(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите TMDB' })).toBeVisible()
  await page.getByLabel('Ключ API или токен доступа').fill(TMDB_KEY)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await skipProwlarr(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()

  // Checked with TMDB before it was kept, then kept in qBittorrent.
  expect(tmdbCalls[0]).toEqual({ device: 'first', path: '/3/authentication', key: TMDB_KEY })
  expect((await clientData())['kinopeer.tmdbKey']).toBe(TMDB_KEY)

  const other = await (await newContext()).newPage()
  await other.goto('/')
  await signIn(other)
  // The key came from qBittorrent: no TMDB step, straight to Prowlarr's.
  await skipProwlarr(other)
  await expect(other.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  // Downloads looks the torrent's title up in TMDB with the key it read.
  await expect.poll(() => tmdbCalls.filter((call) => call.device === 'second').length).toBeGreaterThan(0)
  expect(tmdbCalls.filter((call) => call.key !== TMDB_KEY)).toEqual([])
})
