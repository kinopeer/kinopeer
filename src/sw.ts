/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { cacheNames, clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { PUSH_SUBSCRIPTION_URL, openPush, renewPush, showPush } from './pwa/swPush'
import { POSTER_CACHE, SHELL_DENYLIST, isPosterRequest } from './pwa/swRoutes'
import { WEBUI_PAGES, forgetWorker, loadPage } from './pwa/swWebui'

declare const self: ServiceWorkerGlobalScope

// A new version takes over right away. The app loads as one bundle, but for the texts of the other
// language, so a page that is already open keeps working; src/pwa/updates.ts reloads it into the new
// version, also when it can't load those texts, which the new version's precache no longer has.
void self.skipWaiting()
clientsClaim()

// In the Alternative WebUI build the app's page comes from the network first, and the worker removes
// itself when another page answers in its place (src/pwa/swWebui.ts). Registered before the precache,
// whose route would answer `/` with the cached index.html.
if (__WEBUI__) {
  const load = {
    fetch: (request: Request) => fetch(request),
    cachedPage: () => matchPrecache('/index.html'),
    forget: () => forgetWorker({ registration: self.registration, caches }, [cacheNames.precache, POSTER_CACHE.cacheName]),
  }
  registerRoute(new NavigationRoute(({ request }) => loadPage(request, load), { allowlist: WEBUI_PAGES }))
}

// The app shell: built scripts, styles, fonts and icons, so Kinopeer opens without the network.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// In the server's build every app route (/, /search, /title/…) opens the cached index.html. The
// server's own routes are left alone, and qBittorrent, Prowlarr and TMDB API answers are never
// cached: they must be live.
if (!__WEBUI__) registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: SHELL_DENYLIST }))

// Posters and backdrops never change for a given URL, so keep them for a month.
registerRoute(
  isPosterRequest,
  new CacheFirst({
    cacheName: POSTER_CACHE.cacheName,
    plugins: [
      new CacheableResponsePlugin({ statuses: [...POSTER_CACHE.statuses] }),
      new ExpirationPlugin({ maxEntries: POSTER_CACHE.maxEntries, maxAgeSeconds: POSTER_CACHE.maxAgeSeconds, purgeOnQuotaError: true }),
    ],
  }),
)

// Push notifications (src/pwa/swPush.ts): a finished download, or Settings' test.
self.addEventListener('push', (event) => event.waitUntil(showPush(self.registration, event.data)))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openPush(self.clients, self.location.origin, event.notification.data))
})

/** Not in TypeScript's worker types: the subscription the browser dropped, and its new one if it made one. */
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription: PushSubscription | null
  readonly newSubscription: PushSubscription | null
}

self.addEventListener('pushsubscriptionchange', (event) => {
  const { oldSubscription, newSubscription } = event as PushSubscriptionChangeEvent
  event.waitUntil(
    renewPush(self.registration.pushManager, oldSubscription, newSubscription, self.navigator.languages, (body) =>
      fetch(PUSH_SUBSCRIPTION_URL, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  )
})
