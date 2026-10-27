/**
 * A smoke test of the service worker's wiring: workbox is mocked, so this only checks that sw.ts
 * registers the routes with the rules from src/pwa/swRoutes.ts (tested there). It is compiled with
 * tsconfig.sw.json, like sw.ts, since the worker's types are not the page's.
 */
import { describe, expect, it, vi } from 'vitest'
import { API_DENYLIST, POSTER_CACHE } from './pwa/swRoutes'

class NavigationRoute {
  handler: unknown
  options: unknown
  constructor(handler: unknown, options: unknown) {
    this.handler = handler
    this.options = options
  }
}
class CacheFirst {
  options: unknown
  constructor(options: unknown) {
    this.options = options
  }
}
class CacheableResponsePlugin {
  options: unknown
  constructor(options: unknown) {
    this.options = options
  }
}
class ExpirationPlugin {
  options: unknown
  constructor(options: unknown) {
    this.options = options
  }
}

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }))
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(() => 'the app shell'),
}))
vi.mock('workbox-routing', () => ({ registerRoute: vi.fn(), NavigationRoute }))
vi.mock('workbox-strategies', () => ({ CacheFirst }))
vi.mock('workbox-cacheable-response', () => ({ CacheableResponsePlugin }))
vi.mock('workbox-expiration', () => ({ ExpirationPlugin }))

// The worker script runs once, as this file loads, against this stand-in for its global scope.
// Vitest clears the mocks' records before each test (clearMocks), so what the script did is
// captured here.
const worker = { skipWaiting: vi.fn(), __WB_MANIFEST: [{ url: '/index.html', revision: '1' }] }
vi.stubGlobal('self', worker)
await import('./sw')
const { clientsClaim } = await import('workbox-core')
const { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } = await import('workbox-precaching')
const { registerRoute } = await import('workbox-routing')
const ran = {
  skipWaiting: worker.skipWaiting.mock.calls.length,
  clientsClaim: vi.mocked(clientsClaim).mock.calls.length,
  precached: vi.mocked(precacheAndRoute).mock.calls.map(([manifest]) => manifest),
  cleanedUp: vi.mocked(cleanupOutdatedCaches).mock.calls.length,
  shellBoundTo: vi.mocked(createHandlerBoundToURL).mock.calls.map(([url]) => url),
  routes: vi.mocked(registerRoute).mock.calls as unknown as [unknown, unknown][],
}

describe('the service worker', () => {
  it('takes over right away and precaches the app shell', () => {
    expect(ran.skipWaiting).toBe(1)
    expect(ran.clientsClaim).toBe(1)
    expect(ran.precached).toEqual([worker.__WB_MANIFEST])
    expect(ran.cleanedUp).toBe(1)
  })

  it('serves index.html for app routes, never for the API bridges', () => {
    const [navigation] = ran.routes[0] as [NavigationRoute, unknown]
    expect(navigation).toBeInstanceOf(NavigationRoute)
    expect(ran.shellBoundTo).toEqual(['/index.html'])
    expect(navigation.handler).toBe('the app shell')
    expect(navigation.options).toEqual({ denylist: API_DENYLIST })
  })

  it('caches posters first, for a month, successful answers only', () => {
    const [matcher, strategy] = ran.routes[1] as [(request: { url: URL; sameOrigin: boolean }) => boolean, CacheFirst]
    expect(matcher({ url: new URL('https://kinoseed.local/tmdb-img/w342/dune.jpg'), sameOrigin: true })).toBe(true)
    expect(matcher({ url: new URL('https://kinoseed.local/tmdb/movie/1'), sameOrigin: true })).toBe(false)
    expect(strategy).toBeInstanceOf(CacheFirst)
    expect(strategy.options).toEqual({
      cacheName: POSTER_CACHE.cacheName,
      plugins: [
        expect.objectContaining({ options: { statuses: [200] } }),
        expect.objectContaining({ options: { maxEntries: 500, maxAgeSeconds: POSTER_CACHE.maxAgeSeconds, purgeOnQuotaError: true } }),
      ],
    })
    expect(ran.routes).toHaveLength(2)
  })
})
