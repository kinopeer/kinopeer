import { expect, test } from '@playwright/test'
import { PROXY_DENIED_HEADER, resetStand } from './control.ts'

/**
 * The built service worker on a phone: it precaches the shell behind the proxy, serves it offline
 * (so the app shows its own "unreachable" screen, not the browser's error page), comes back on
 * Retry, and keeps posters but never the live answers of qBittorrent, Prowlarr or TMDB.
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
  await expect(page.getByText('qBittorrent недоступен')).toBeVisible()

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  expect(refused).toEqual([])
})
