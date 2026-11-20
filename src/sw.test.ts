/**
 * A smoke test of the service worker's wiring: workbox is mocked, so this only checks that sw.ts
 * registers the routes with the rules from src/pwa/swRoutes.ts (tested there). It is compiled with
 * tsconfig.sw.json, like sw.ts, since the worker's types are not the page's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSTER_CACHE, SHELL_DENYLIST } from './pwa/swRoutes'

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
const listeners = new Map<string, (event: unknown) => void>()
const worker = {
  skipWaiting: vi.fn(),
  __WB_MANIFEST: [{ url: '/index.html', revision: '1' }],
  addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  registration: { showNotification: vi.fn(async () => {}), pushManager: { subscribe: vi.fn() } },
  clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => null) },
  location: { origin: 'https://kinopeer.local' },
  navigator: { languages: ['ru-RU', 'en'] },
}
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
    expect(navigation.options).toEqual({ denylist: SHELL_DENYLIST })
  })

  it('caches posters first, for a month, successful answers only', () => {
    const [matcher, strategy] = ran.routes[1] as [(request: { url: URL; sameOrigin: boolean }) => boolean, CacheFirst]
    expect(matcher({ url: new URL('https://kinopeer.local/tmdb-img/w342/dune.jpg'), sameOrigin: true })).toBe(true)
    expect(matcher({ url: new URL('https://kinopeer.local/tmdb/movie/1'), sameOrigin: true })).toBe(false)
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

  // The listeners read the worker's scope when an event comes; Vitest unstubs globals before each test.
  beforeEach(() => {
    vi.stubGlobal('self', worker)
  })

  /** Dispatches `type` to the worker's listener and waits for what it handed `waitUntil`. */
  async function dispatch(type: string, event: object) {
    let work: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) })
    await work
  }

  it('shows a push as a notification', async () => {
    const payload = { title: 'Download finished', body: 'Dune (2021)', url: '/torrent/abc', tag: 'abc' }
    await dispatch('push', { data: { json: () => payload } })
    expect(worker.registration.showNotification).toHaveBeenCalledWith('Download finished', expect.objectContaining({ body: 'Dune (2021)', tag: 'abc', data: { url: '/torrent/abc' } }))
  })

  it('closes a tapped notification and opens its page', async () => {
    const notification = { close: vi.fn(), data: { url: '/torrent/abc' } }
    await dispatch('notificationclick', { notification })
    expect(notification.close).toHaveBeenCalled()
    expect(worker.clients.openWindow).toHaveBeenCalledWith('https://kinopeer.local/torrent/abc')
  })

  it('saves a renewed subscription on the server in place of the old one', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', send)
    const renewed = { endpoint: 'https://fcm.googleapis.com/new', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/new', keys: { p256dh: 'key', auth: 'secret' } }) }
    await dispatch('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/old', toJSON: () => ({}) }, newSubscription: renewed })
    expect(send).toHaveBeenCalledWith('/api/push/subscription', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/new', p256dh: 'key', auth: 'secret', language: 'ru', replaces: 'https://fcm.googleapis.com/old' }),
    })
  })
})
