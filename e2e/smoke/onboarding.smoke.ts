import { expect, test } from './test.ts'
import { LOGIN, PROWLARR_KEY, PROXY_COOKIE, PROXY_DENIED_HEADER, TMDB_KEY, resetStand, standState } from './control.ts'

/**
 * Onboarding on a phone, from a server with no login and no key to the list: the login and the
 * key go to the server and stay there, the browser never holds qBittorrent's session, and a
 * page reload rides on the server's session.
 */
test('onboarding: the qBittorrent session and the keys stay on the server', async ({ page, context }) => {
  await resetStand({ configured: false })
  const requests: { url: string; body: string | null }[] = []
  page.on('request', (request) => requests.push({ url: request.url(), body: request.postData() }))
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(response.url())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите qBittorrent' })).toBeVisible()

  // A wrong password: the server tries it once, says so, and never retries on its own.
  await page.getByRole('textbox', { name: 'Логин' }).fill(LOGIN.username)
  await page.getByLabel('Пароль').fill('wrong')
  await page.getByRole('button', { name: 'Подключить' }).click()
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible()
  let stand = await standState()
  expect(stand.qbittorrent.logins).toBe(1)
  // Everything so far went without a session (and got 403): the requests after must all carry one.
  const unauthenticated = stand.qbittorrent.seen.length

  await page.getByLabel('Пароль').fill(LOGIN.password)
  await page.getByRole('button', { name: 'Подключить' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Подключите TMDB' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Ключ API или токен доступа' }).fill(TMDB_KEY)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  // The titles come from TMDB through the server, with the key it just saved.
  await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()

  stand = await standState()
  // The right password: once to check it, once more for the server's own session.
  expect(stand.qbittorrent.logins).toBe(3)
  expect(stand.qbittorrent.seen.slice(unauthenticated).map((request) => request.cookie)).toEqual(
    stand.qbittorrent.seen.slice(unauthenticated).map(() => expect.stringMatching(/^SID=\w+$/)),
  )
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual([PROXY_COOKIE])
  expect(stand.settings).toEqual({ qbittorrentUsername: LOGIN.username, qbittorrentPassword: LOGIN.password, tmdbApiKey: TMDB_KEY })
  expect(stand.tmdb.seen.map((request) => request.url)).toContain(`/3/authentication?api_key=${TMDB_KEY}`)

  // The browser can't log in to qBittorrent itself: the route stops before the server's bridge.
  const login = await page.evaluate(() =>
    fetch('/qbt/api/v2/auth/login', { method: 'POST', body: 'username=admin&password=x' }).then((response) => response.status),
  )
  expect(login).toBe(404)
  expect((await standState()).qbittorrent.logins).toBe(3)

  // A reload goes straight to the list on the session the server keeps.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()
  expect((await standState()).qbittorrent.logins).toBe(3)

  // No key in anything the page sent, except the TMDB key in the body that saved it; and the
  // proxy refused nothing, so every fetch carried its cookie.
  for (const { url, body } of requests) {
    expect(url).not.toContain(PROWLARR_KEY)
    expect(url).not.toContain(TMDB_KEY)
    expect(body ?? '').not.toContain(PROWLARR_KEY)
    if (!url.endsWith('/api/settings/tmdb')) expect(body ?? '').not.toContain(TMDB_KEY)
  }
  expect(refused).toEqual([])
})
