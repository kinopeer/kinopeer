/**
 * The service worker's routing rules (src/sw.ts), kept apart from workbox so they can be checked as
 * plain logic: what must never come from the cache, and which images may.
 */

/**
 * The query parameter of a page load meant for a proxy in front of Kinopeer (src/pwa/proxySignIn.ts):
 * it has to reach the proxy, so the app shell doesn't answer it.
 */
export const PROXY_SIGN_IN_PARAM = 'proxy-sign-in'

/**
 * Page loads the app shell must not answer for, matched on the path and query: the server's own
 * routes and the qBittorrent, Prowlarr and TMDB bridges, whose answers must be live (a cached
 * index.html in their place would break the app silently), and a load meant for the sign-in proxy.
 */
export const SHELL_DENYLIST: RegExp[] = [/^\/(api|qbt|prowlarr|tmdb|tmdb-img)\//, new RegExp(`[?&]${PROXY_SIGN_IN_PARAM}=`)]

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
