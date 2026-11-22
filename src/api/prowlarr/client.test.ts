import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProwlarrError, ProwlarrSetupError, fetchRelease, getFailingIndexers, searchReleases } from './client'
import type { Release } from './types'
import { KinopeerUnreachableError } from '../qbittorrent/client'

let fetchMock: Mock<typeof fetch>

const RELEASE: Release = { id: 'g1', title: 'Dune / Дюна (2021)', indexer: 'Indexer C', size: 1, categories: [2000], download: '1/download?link=A' }

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('searchReleases', () => {
  it('takes an answer without the bridge’s code for Kinopeer’s server not answering (#566)', async () => {
    // Something in front of the server answering for it, or the SPA fallback of a server without the bridge.
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(searchReleases('a')).rejects.toBeInstanceOf(KinopeerUnreachableError)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
    await expect(searchReleases('a')).rejects.toMatchObject({ name: 'KinopeerUnreachableError', status: 502 })
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 502 }))
    await expect(searchReleases('a')).rejects.toBeInstanceOf(KinopeerUnreachableError)
  })

  it('takes the bridge’s setup codes for a setup problem', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'not-configured' }, { status: 503 }))
    await expect(searchReleases('a')).rejects.toMatchObject({ name: 'ProwlarrSetupError', code: 'not-configured' })
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'unauthorized' }, { status: 502 }))
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)
  })
})

describe('a Prowlarr that didn’t answer', () => {
  it('passes on why, where the server could tell (#508)', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'unreachable', failure: 'name' }, { status: 502 }))
    await expect(searchReleases('a')).rejects.toMatchObject({ status: 502, code: 'unreachable', failure: 'name' })
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'unreachable', failure: 'solar-flare' }, { status: 502 }))
    const error = await searchReleases('a').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'unreachable' })
    expect((error as ProwlarrError).failure).toBeUndefined()
  })
})

describe('getFailingIndexers', () => {
  it('says how long ago the search started, in whole milliseconds, and answers with the names', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ indexers: ['Indexer C'] }))
    await expect(getFailingIndexers(1234.6)).resolves.toEqual(['Indexer C'])
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
