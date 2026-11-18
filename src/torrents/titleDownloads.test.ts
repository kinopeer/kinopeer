import { describe, expect, it } from 'vitest'
import { title, tmdbTag, torrent } from '../test/fixtures'
import { GUESS_VERSION, lookupFor, slim, type TitleMatch } from './titleLookup'
import { downloadsMark, titleKey, torrentsByTitle } from './titleDownloads'

describe('downloadsMark', () => {
  it('says nothing without torrents', () => {
    expect(downloadsMark([])).toBeUndefined()
  })

  it('gives one torrent’s progress', () => {
    expect(downloadsMark([{ progress: 0.62 }])).toEqual({ progress: 0.62 })
  })

  it('gives the count of several, whatever their progress', () => {
    expect(downloadsMark([{ progress: 1 }, { progress: 0.1 }])).toEqual({ count: 2 })
  })
})

describe('torrentsByTitle', () => {
  const DUNE = slim(title('movie', 693134, 'Dune: Part Two', 2024))
  const noCache = () => undefined

  it('files a tagged torrent under its tag’s title', () => {
    const tagged = torrent('a', { tags: tmdbTag('movie', 693134) })
    expect(torrentsByTitle([tagged], {}, noCache)).toEqual(new Map([['movie:693134', [tagged]]]))
  })

  it('takes the user’s choice over the tag', () => {
    const tagged = torrent('a', { tags: tmdbTag('movie', 693134) })
    const byTitle = torrentsByTitle([tagged], { a: { type: 'tv', id: 1, source: 'user' } }, noCache)
    expect([...byTitle.keys()]).toEqual(['tv:1'])
  })

  it('takes a guess the server keeps, of this version of guessing only', () => {
    const untagged = torrent('a', { name: 'Dune.Part.Two.2024.1080p' })
    const current = { a: { type: 'movie', id: 693134, source: 'guess', version: GUESS_VERSION } } as const
    expect([...torrentsByTitle([untagged], current, noCache).keys()]).toEqual(['movie:693134'])
    const stale = { a: { ...current.a, version: GUESS_VERSION - 1 } }
    expect(torrentsByTitle([untagged], stale, noCache).size).toBe(0)
  })

  it('takes a guess this browser cached by the lookup’s key, and none it found nothing for', () => {
    const untagged = torrent('a', { name: 'Dune.Part.Two.2024.1080p' })
    const key = lookupFor(untagged).key
    const cache = (found: TitleMatch | null) => (asked: string) => (asked === key ? found : undefined)
    expect([...torrentsByTitle([untagged], {}, cache(DUNE)).keys()]).toEqual(['movie:693134'])
    expect(torrentsByTitle([untagged], {}, cache(null)).size).toBe(0)
  })

  it('leaves out a torrent nobody has guessed yet', () => {
    expect(torrentsByTitle([torrent('a', { name: 'Dune.Part.Two.2024.1080p' })], {}, noCache).size).toBe(0)
  })

  it('files several torrents of a title together, apart from another title’s', () => {
    const first = torrent('a', { tags: tmdbTag('movie', 693134) })
    const second = torrent('b', { tags: tmdbTag('movie', 693134) })
    const series = torrent('c', { tags: tmdbTag('tv', 693134) })
    const byTitle = torrentsByTitle([first, series, second], {}, noCache)
    expect(byTitle.get(titleKey('movie', 693134))).toEqual([first, second])
    expect(byTitle.get(titleKey('tv', 693134))).toEqual([series])
  })
})
