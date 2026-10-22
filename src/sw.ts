/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// A new version takes over right away. The app loads as one bundle (no lazy chunks), so a page
// that is already open keeps working, and the next launch opens the new version.
void self.skipWaiting()
clientsClaim()

// The app shell: built scripts, styles, fonts and icons, so Kinoseed opens without the network.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every app route (/, /search, /title/…) opens the cached index.html. The server's own routes are
// left alone, and qBittorrent, Prowlarr and TMDB API answers are never cached: they must be live.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/(api|qbt|prowlarr|tmdb|tmdb-img)\//],
  }),
)

// Posters and backdrops never change for a given URL, so keep them for a month.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/tmdb-img/'),
  new CacheFirst({
    cacheName: 'tmdb-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
)
