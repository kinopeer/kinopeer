import { describe, expect, it } from 'vitest'
import { API_DENYLIST, POSTER_CACHE, isPosterRequest } from './swRoutes'

const denied = (path: string) => API_DENYLIST.some((pattern) => pattern.test(path))

describe('API_DENYLIST', () => {
  it.each(['/api/settings', '/api/matches', '/qbt/api/v2/sync/maindata', '/prowlarr/search?query=dune', '/tmdb/movie/1', '/tmdb-img/w342/x.jpg'])(
    'keeps the app shell away from %s',
    (path) => {
      expect(denied(path)).toBe(true)
    },
  )

  it.each(['/', '/search', '/search?q=dune', '/title/movie/1', '/title/tv/1/releases', '/torrent/abc', '/settings', '/api', '/qbtx/'])(
    'lets the app shell answer %s',
    (path) => {
      expect(denied(path)).toBe(false)
    },
  )
})

describe('isPosterRequest', () => {
  it('matches posters from the same-origin image proxy only', () => {
    expect(isPosterRequest({ url: new URL('https://kinopeer.local/tmdb-img/w342/dune.jpg'), sameOrigin: true })).toBe(true)
    expect(isPosterRequest({ url: new URL('https://image.tmdb.org/tmdb-img/w342/dune.jpg'), sameOrigin: false })).toBe(false)
    expect(isPosterRequest({ url: new URL('https://kinopeer.local/tmdb/movie/1'), sameOrigin: true })).toBe(false)
    expect(isPosterRequest({ url: new URL('https://kinopeer.local/assets/tmdb-img.svg'), sameOrigin: true })).toBe(false)
  })
})

describe('POSTER_CACHE', () => {
  it('keeps successful answers for a month, the newest 500', () => {
    expect(POSTER_CACHE).toEqual({ cacheName: 'tmdb-images', statuses: [200], maxEntries: 500, maxAgeSeconds: 2_592_000 })
  })
})
