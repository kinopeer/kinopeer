import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProwlarrError, ProwlarrSetupError, fetchRelease, getProwlarrStatus, searchReleases } from './client'
import { MOVIE_CATEGORY, type Release } from './types'

let fetchMock: Mock<typeof fetch>

function json(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const RELEASE: Release = { id: 'g1', title: 'Dune / Дюна (2021)', indexer: 'Kinozal', size: 1, categories: [2000], download: '1/download?link=A' }

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchReleases', () => {
  it('queries the bridge', async () => {
    json([RELEASE])
    await expect(searchReleases('Dune', { type: 'movie', categories: [MOVIE_CATEGORY] })).resolves.toEqual([RELEASE])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/prowlarr/search?query=Dune&type=movie&categories=2000')
    expect(init?.credentials).toBe('same-origin')
  })

  it('tells setup problems from other failures', async () => {
    json({ error: 'not-configured' }, 503)
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)
    json({ error: 'unauthorized' }, 502)
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)
    // The SPA fallback answering instead of the bridge.
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)

    json({ error: 'unreachable' }, 502)
    const error = await searchReleases('a').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProwlarrError)
    expect(error).not.toBeInstanceOf(ProwlarrSetupError)
    expect((error as ProwlarrError).code).toBe('unreachable')
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
    expect(fetchMock.mock.calls[0][0]).toBe('/prowlarr/download?token=1%2Fdownload%3Flink%3DA')
    expect(source.kind).toBe('torrent')
    const file = (source as { file: File }).file
    expect(file.name).toBe('Dune Дюна (2021).torrent')
    expect(file.size).toBe(2)
  })

  it('prefers the .torrent and falls back to the magnet link', async () => {
    const release = { ...RELEASE, magnet: 'magnet:?xt=urn:btih:abc' }
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([100]), { headers: { 'Content-Type': 'application/x-bittorrent' } }))
    await expect(fetchRelease(release)).resolves.toMatchObject({ kind: 'torrent' })

    json({ error: 'upstream' }, 502)
    await expect(fetchRelease(release)).resolves.toEqual({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
  })

  it('returns the magnet link Prowlarr redirected to', async () => {
    json({ magnet: 'magnet:?xt=urn:btih:def' })
    await expect(fetchRelease(RELEASE)).resolves.toEqual({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:def' })
  })
})

describe('getProwlarrStatus', () => {
  it('returns the version and indexer count, or a setup error', async () => {
    json({ version: '1.24.3', indexers: 2 })
    await expect(getProwlarrStatus()).resolves.toEqual({ version: '1.24.3', indexers: 2 })
    expect(fetchMock.mock.calls[0][0]).toBe('/prowlarr/status')

    json({ error: 'unauthorized' }, 502)
    await expect(getProwlarrStatus()).rejects.toBeInstanceOf(ProwlarrSetupError)
  })
})
