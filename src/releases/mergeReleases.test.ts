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

  it('tells releases without a hash apart by Prowlarr’s guid, which each search gives the same, unlike the download link', () => {
    // Prowlarr encrypts each search's download links afresh, so the same release comes with another token.
    const first = release('https://indexer-a.example.org/1', { download: '1/download?link=x' })
    const again = release('https://indexer-a.example.org/1', { download: '1/download?link=y' })
    const other = release('https://indexer-a.example.org/2', { download: '1/download?link=x' })
    expect(mergeReleases([[first], [again, other]])).toEqual([first, other])
  })

  it('takes an empty hash for none', () => {
    const a = release('a', { infoHash: '' })
    const b = release('b', { infoHash: '' })
    expect(mergeReleases([[a], [b]])).toEqual([a, b])
  })

  it('keeps a search’s own list as it is, releases that read as the same included', () => {
    const a = release('same', { download: 'x' })
    const b = release('same', { download: 'y' })
    expect(mergeReleases([[a, b]])).toEqual([a, b])
    expect(mergeReleases([[a, b], [release('same', { download: 'z' })]])).toEqual([a, b])
  })

  it('keeps two releases with the same guid but different hashes', () => {
    const a = release('same', { infoHash: 'aa' })
    const b = release('same', { infoHash: 'bb' })
    expect(mergeReleases([[a], [b]])).toEqual([a, b])
  })
})
