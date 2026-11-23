import { describe, expect, it } from 'vitest'
import type { Release } from '../api/prowlarr'
import { mergeReleases } from './mergeReleases'

const release = (id: string, more: Partial<Release> = {}): Release => ({ id, title: id, indexer: 'Indexer A', size: 1, categories: [], ...more })

describe('mergeReleases', () => {
  it('keeps every release of each search, in the order found', () => {
    const a = release('a', { infoHash: 'aa' })
    const b = release('b', { infoHash: 'bb' })
    const c = release('c', { infoHash: 'cc' })
    expect(mergeReleases([[a, b], [c]])).toEqual([a, b, c])
  })

  it('keeps a release both searches found once, by its info hash in any case, as the first search found it', () => {
    const first = release('a', { infoHash: 'ABCDEF' })
    const again = release('a2', { infoHash: 'abcdef', indexer: 'Indexer B' })
    expect(mergeReleases([[first], [again]])).toEqual([first])
  })

  it('tells releases without a hash apart by their download link', () => {
    const first = release('a', { download: '1/download?link=x' })
    const again = release('b', { download: '1/download?link=x' })
    const other = release('c', { download: '1/download?link=y' })
    expect(mergeReleases([[first], [again, other]])).toEqual([first, other])
  })

  it('tells releases with neither by Prowlarr’s guid', () => {
    const bare = release('c')
    const sameBare = release('c')
    const otherBare = release('d')
    expect(mergeReleases([[bare], [sameBare, otherBare]])).toEqual([bare, otherBare])
  })

  it('keeps two releases with the same download link but different hashes', () => {
    const a = release('a', { infoHash: 'aa', download: 'same' })
    const b = release('b', { infoHash: 'bb', download: 'same' })
    expect(mergeReleases([[a], [b]])).toEqual([a, b])
  })
})
