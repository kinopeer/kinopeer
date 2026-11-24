import type { Page } from '@playwright/test'
import { alternativeWebui, clientData, enableAlternativeWebui, LOGIN, SEEDED_HASH, SEEDED_NAME } from './qbittorrent.ts'
import { expect, SHOGUN, test } from './test.ts'

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

// The journeys run in this order (one worker): the second starts from the first's key and match,
// which its reset removes from qBittorrent with nulls (e2e/webui/test.ts). The last turns Kinopeer
// off in qBittorrent and back on from Node when it ends.

/**
 * Settings and matches saved to qBittorrent's `clientdata` and read back on another device: the
 * TMDB key the first browser saves is checked with TMDB and kept in qBittorrent under Kinopeer's
 * key, and so is the title Downloads guessed for the torrent; a second browser, with nothing of the
 * first's in its storage, isn't asked for the key, shows the title without searching for it, and
 * asks TMDB for its details with the key it read.
 */
test('the TMDB key and a match kept in qBittorrent, read back by another browser', async ({ page, tmdbCalls, newContext }) => {
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
  // The title guessed from the release name, kept in qBittorrent before the second device reads it.
  await expect(page.getByText(SHOGUN.name).first()).toBeVisible()
  await expect.poll(async () => (await clientData())[`kinopeer.match.${SEEDED_HASH}`]).toMatchObject({ type: 'tv', id: SHOGUN.id })

  const other = await (await newContext()).newPage()
  await other.goto('/')
  await signIn(other)
  // The key came from qBittorrent: no TMDB step, straight to Prowlarr's.
  await skipProwlarr(other)
  await expect(other.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect(other.getByText(SHOGUN.name).first()).toBeVisible()
  const second = tmdbCalls.filter((call) => call.device === 'second')
  // The match came from qBittorrent: the title's details asked for with the key, no search.
  expect(second).toContainEqual({ device: 'second', path: `/3/tv/${SHOGUN.id}`, key: TMDB_KEY })
  expect(second.filter((call) => call.path.startsWith('/3/search/'))).toEqual([])
  expect(tmdbCalls.filter((call) => call.key !== TMDB_KEY)).toEqual([])
})

/**
 * qBittorrent's own login from the page, then Downloads: qBittorrent serves the build at `/`
 * (Kinopeer's page, not its own interface), refuses a wrong password, and the login from the
 * browser gives the page qBittorrent's session, which the poll's calls on the page's own origin
 * carry, listing the torrent the stand added. The previous journey's key is gone from qBittorrent,
 * so onboarding asks for TMDB again, and without a key the page asks TMDB nothing.
 */
test('the login, then Downloads', async ({ page, tmdbCalls }) => {
  // Downloads' title lookups wait for the matches, loaded from qBittorrent as every key of
  // `clientdata` (no `keys` in the query), which may answer after the torrent's row shows.
  const matchesLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v2/clientdata/load' && !url.searchParams.has('keys')
  })
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
  // No call is an absence nothing signals: once the matches are in, the lookups start at once, so
  // a call without a key would go out within this deadline.
  await matchesLoaded
  await page.waitForTimeout(2_000)
  expect(tmdbCalls).toEqual([])
})

/**
 * The way back to qBittorrent's own interface: Settings' row and its confirmation turn off
 * qBittorrent's Alternative WebUI, and the page then loaded at qBittorrent's root is qBittorrent's
 * own interface, signed in with the session Kinopeer's login gave, without anything else to do, and
 * the folder qBittorrent serves Kinopeer from stays set.
 */
test("Settings switch to qBittorrent's own interface", async ({ page }) => {
  try {
    await page.goto('/')
    await signIn(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Подключите TMDB' })).toBeVisible()
    await page.getByRole('button', { name: 'Пропустить' }).click()
    await skipProwlarr(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()

    await page.getByRole('link', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: /Перейти в интерфейс qBittorrent/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Перейти в интерфейс qBittorrent?' })
    await dialog.getByRole('button', { name: 'Перейти' }).click()

    // qBittorrent's own page for a signed-in session (src/webui/www/private/index.html), at its root.
    await expect(page).toHaveTitle('qBittorrent WebUI')
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'qBittorrent')
    expect(new URL(page.url()).pathname).toBe('/')
    // Off, and the folder left as qBittorrent.conf set it, so turning it on again brings Kinopeer back.
    expect(await alternativeWebui()).toEqual({ enabled: false, path: '/webui' })
  } finally {
    await enableAlternativeWebui()
  }
})
