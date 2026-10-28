import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProwlarrSetupError, fetchRelease, getFailingIndexers, searchReleases } from './client'
import type { Release } from './types'

let fetchMock: Mock<typeof fetch>

const RELEASE: Release = { id: 'g1', title: 'Dune / Дюна (2021)', indexer: 'Kinozal', size: 1, categories: [2000], download: '1/download?link=A' }

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchReleases', () => {
  it('treats an answer without JSON as a setup problem', async () => {
    // The SPA fallback answering instead of the bridge.
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)
  })
})

describe('getFailingIndexers', () => {
  it('asks for the failures since the given time and answers with their names', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ indexers: ['Kinozal'] }))
    await expect(getFailingIndexers(new Date('2026-10-28T00:59:00Z'))).resolves.toEqual(['Kinozal'])
    expect(fetchMock.mock.calls[0][0]).toBe('/prowlarr/failing?since=2026-10-28T00%3A59%3A00.000Z')
  })
})

describe('fetchRelease', () => {
  it('uses a magnet link as is when there is no .torrent', async () => {
    await expect(fetchRelease({ ...RELEASE, download: undefined, magnet: 'magnet:?xt=urn:btih:abc' })).resolves.toEqual({
      kind: 'magnet',
      uri: 'magnet:?xt=urn:btih:abc',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads the .torrent file', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([100, 101]), { headers: { 'Content-Type': 'application/x-bittorrent' } }))
    const source = await fetchRelease(RELEASE)
    expect(source.kind).toBe('torrent')
    const file = (source as { file: File }).file
    expect(file.name).toBe('Dune Дюна (2021).torrent')
    expect(file.size).toBe(2)
  })

})
