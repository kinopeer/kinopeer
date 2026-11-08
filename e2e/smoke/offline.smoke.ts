import { expect, test } from './test.ts'
import { PROXY_DENIED_HEADER, resetStand } from './control.ts'

/**
 * The built service worker on a phone: it precaches the shell behind the proxy, serves it offline
 * (so the app shows its own "unreachable" screen, not the browser's error page), comes back on
 * Open again, past the worker, and keeps posters but never the live answers of qBittorrent,
 * Prowlarr or TMDB.
 */
test('the service worker keeps the shell offline and never the live data', async ({ page, context }) => {
  await resetStand()
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(response.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  // Once more online, now through the worker, so the posters go into their cache.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const urls: string[] = []
        for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname)
        return urls
      }),
    )
    .toEqual(expect.arrayContaining(['/index.html', expect.stringMatching(/^\/tmdb-img\//)]))
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname)
    return urls
  })
  expect(cached.filter((path) => /^\/(api|qbt|prowlarr|tmdb)\//.test(path))).toEqual([])

  await context.setOffline(true)
  await page.reload()
  // The whole network is down, so it's Kinopeer's server that doesn't answer, not qBittorrent.
  await expect(page.getByText('Kinopeer не отвечает')).toBeVisible()
  // Offline, Open again would only swap this screen for the browser's error page: Retry alone.
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть заново' })).toHaveCount(0)

  // Back online it offers Open again too, which loads the page past the worker (#311), so it comes
  // from the network, and the app takes the parameter back out of the address.
  await context.setOffline(false)
  const loads: string[] = []
  page.on('request', (request) => {
    if (request.isNavigationRequest()) loads.push(new URL(request.url()).pathname + new URL(request.url()).search)
  })
  await page.getByRole('button', { name: 'Открыть заново' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  expect(loads).toEqual(['/?proxy-sign-in=1'])
  expect(new URL(page.url()).search).toBe('')
  expect(refused).toEqual([])
})
