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
  it('says how long ago the search started, in whole milliseconds, and answers with the names', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ indexers: ['Kinozal'] }))
    await expect(getFailingIndexers(1234.6)).resolves.toEqual(['Kinozal'])
    expect(fetchMock.mock.calls[0][0]).toBe('/prowlarr/failing?within=1235')
  })

  it('asks about ten minutes at most, however long the page waited', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ indexers: [] }))
    await getFailingIndexers(45 * 60 * 1000)
    expect(fetchMock.mock.calls[0][0]).toBe('/prowlarr/failing?within=600000')
  })

  it('rejects when the server can’t tell', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'upstream' }, { status: 502 }))
    await expect(getFailingIndexers(0)).rejects.toMatchObject({ status: 502, code: 'upstream' })
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
