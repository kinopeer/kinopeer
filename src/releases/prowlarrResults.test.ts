import { describe, expect, it } from 'vitest'
import { MAX_TORRENT_BYTES, downloadToken, downloadUrl, failedIds, indexerNames, isTorrentFile, toRelease } from './prowlarrResults'

const KEY = 'secret-key-123'

describe('downloadToken', () => {
  it('keeps the indexer and link but drops the API key', () => {
    expect(downloadToken(`http://prowlarr:9696/12/download?apikey=${KEY}&link=abc%3D&file=Dune`)).toBe(
      '12/download?link=abc%3D&file=Dune',
    )
    expect(downloadToken('http://prowlarr:9696/api/v1/indexer')).toBeUndefined()
    expect(downloadToken('not a url')).toBeUndefined()
    expect(downloadToken(undefined)).toBeUndefined()
    // A download path with more after it isn't Prowlarr's link.
    expect(downloadToken('http://prowlarr:9696/12/download/more?link=abc')).toBeUndefined()
  })
})

describe('downloadUrl', () => {
  it('rebuilds the link from a token with the key, through /api/', () => {
    expect(downloadUrl('http://prowlarr:9696', '12/download?link=abc&apikey=old', KEY)?.href).toBe(
      `http://prowlarr:9696/api/v1/indexer/12/download?link=abc&apikey=${KEY}`,
    )
  })

  it('rebuilds nothing but a token', () => {
    expect(downloadUrl('http://prowlarr:9696', '../system/status?x=1', KEY)).toBeUndefined()
    expect(downloadUrl('http://prowlarr:9696', 'x12/download?link=abc', KEY)).toBeUndefined()
  })
})

describe('toRelease', () => {
  const item = { guid: 'g1', title: 'Dune.2021.2160p.WEB-DL-GRPA', downloadUrl: 'http://prowlarr:9696/1/download?link=abc' }

  it('keeps the hash in lower case and drops an IMDb or TMDB id of 0', () => {
    expect(toRelease({ ...item, infoHash: 'ABCDEF', imdbId: 1160419, tmdbId: 0 })).toMatchObject({
      infoHash: 'abcdef',
      imdbId: 1160419,
      tmdbId: undefined,
    })
  })

  it('takes no result without its id or its title', () => {
    expect(toRelease({ ...item, guid: undefined })).toBeUndefined()
    expect(toRelease({ ...item, title: '' })).toBeUndefined()
  })
})

describe('isTorrentFile', () => {
  it('takes a bencoded dictionary up to the largest size, nothing else', () => {
    expect(isTorrentFile(new Uint8Array([0x64, 0x65]))).toBe(true)
    expect(isTorrentFile(new TextEncoder().encode('<html>'))).toBe(false)
    const largest = new Uint8Array(MAX_TORRENT_BYTES)
    largest[0] = 0x64
    expect(isTorrentFile(largest)).toBe(true)
    const larger = new Uint8Array(MAX_TORRENT_BYTES + 1)
    larger[0] = 0x64
    expect(isTorrentFile(larger)).toBe(false)
  })
})

describe('failedIds and indexerNames', () => {
  const now = Date.parse('2026-10-28T01:00:00Z')
  const since = Date.parse('2026-10-28T00:59:00Z')
  const indexers = [
    { id: 1, name: 'Indexer D', enable: true },
    { id: 2, name: 'Indexer C', enable: true },
    { id: 3, name: 'Old', enable: false },
    { id: 4, name: 'Fine', enable: true },
    { id: 5, name: 'Earlier', enable: true },
  ]

  it('names enabled indexers that failed during the search or are on hold, sorted', () => {
    const statuses = [
      { indexerId: 1, mostRecentFailure: '2026-10-28T00:59:30Z' },
      { indexerId: 2, disabledTill: '2026-10-28T02:00:00Z', mostRecentFailure: '2026-10-27T20:00:00Z' },
      { indexerId: 3, disabledTill: '2026-10-28T02:00:00Z' },
      { indexerId: 4, disabledTill: '2026-10-28T00:30:00Z' },
      // Failed before this search and isn't on hold: an older failure, not this search's.
      { indexerId: 5, mostRecentFailure: '2026-10-28T00:58:59Z' },
    ]
    expect(indexerNames(indexers, failedIds(statuses, since, now))).toEqual(['Indexer C', 'Indexer D'])
  })

  it('names none when nothing failed', () => {
    expect(indexerNames(indexers, failedIds([], since, now))).toEqual([])
  })

  it('never counts a row without an id as a failure', () => {
    const statuses = [{ mostRecentFailure: '2026-10-28T00:59:30Z' }]
    expect(failedIds(statuses, since, now)).toEqual(new Set())
    expect(indexerNames([...indexers, { name: 'No id', enable: true }], failedIds(statuses, since, now))).toEqual([])
    // Nor names an indexer without an id, whatever the ids.
    expect(indexerNames([{ name: 'No id', enable: true }], new Set([undefined]) as unknown as Set<number>)).toEqual([])
  })

  it('counts a failure at the very start of the search, and a hold ending now as over', () => {
    const statuses = [
      { indexerId: 1, mostRecentFailure: '2026-10-28T00:59:00Z' },
      { indexerId: 2, disabledTill: '2026-10-28T01:00:00Z' },
    ]
    expect(failedIds(statuses, since, now)).toEqual(new Set([1]))
  })
})
