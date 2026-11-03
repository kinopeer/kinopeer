/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { API_DENYLIST, POSTER_CACHE, isPosterRequest } from './pwa/swRoutes'

declare const self: ServiceWorkerGlobalScope

// A new version takes over right away. The app loads as one bundle (no lazy chunks), so a page
// that is already open keeps working; src/pwa/updates.ts reloads it into the new version.
void self.skipWaiting()
clientsClaim()

// The app shell: built scripts, styles, fonts and icons, so Kinoseed opens without the network.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every app route (/, /search, /title/…) opens the cached index.html. The server's own routes are
// left alone, and qBittorrent, Prowlarr and TMDB API answers are never cached: they must be live.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: API_DENYLIST }))

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
