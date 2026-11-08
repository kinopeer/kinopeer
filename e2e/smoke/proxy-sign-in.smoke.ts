import { expect, test } from './test.ts'
import { PROXY_COOKIE, PROXY_DENIED_HEADER, resetStand } from './control.ts'

/**
 * The proxy's cookie lapsing under an installed app (#303): the service worker answers the reload
 * from its cache, so nothing reaches the proxy as a page load, and the app's first requests come
 * back redirected to the sign-in. The app then loads the screen through the proxy with the
 * sign-in parameter, which the service worker leaves to the network, gets the cookie, takes the
 * parameter out of the address and works again, on the same screen.
 */
test('an app whose proxy cookie lapsed signs in through the proxy and comes back', async ({ page, context }) => {
  await resetStand()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  const loads: string[] = []
  const refused: string[] = []
  page.on('request', (request) => {
    if (request.isNavigationRequest()) loads.push(new URL(request.url()).pathname + new URL(request.url()).search)
  })
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(new URL(response.url()).pathname)
  })
  await context.clearCookies()
  await page.reload()

  await expect.poll(() => loads).toContain('/?proxy-sign-in=1')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()
  expect(new URL(page.url()).search).toBe('')
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual([PROXY_COOKIE])
  // The proxy did refuse the shell's first requests, and only once: no loop.
  expect(refused.length).toBeGreaterThan(0)
  expect(loads.filter((load) => load.includes('proxy-sign-in'))).toEqual(['/?proxy-sign-in=1'])
})
