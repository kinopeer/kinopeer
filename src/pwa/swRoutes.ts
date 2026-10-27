/**
 * The service worker's routing rules (src/sw.ts), kept apart from workbox so they can be checked as
 * plain logic: what must never come from the cache, and which images may.
 */

/**
 * Paths the app shell must not answer for: the server's own routes and the qBittorrent, Prowlarr
 * and TMDB bridges. Their answers must be live, and a cached index.html in their place would break
 * the app silently.
 */
export const API_DENYLIST: RegExp[] = [/^\/(api|qbt|prowlarr|tmdb|tmdb-img)\//]

/** Posters and backdrops through the same-origin image proxy: they never change for a given URL. */
export function isPosterRequest({ url, sameOrigin }: { url: URL; sameOrigin: boolean }): boolean {
  return sameOrigin && url.pathname.startsWith('/tmdb-img/')
}

/** How long and how many of them to keep: successful answers only, a month, the newest 500. */
export const POSTER_CACHE = {
  cacheName: 'tmdb-images',
  statuses: [200],
  maxEntries: 500,
  maxAgeSeconds: 30 * 24 * 60 * 60,
} as const
