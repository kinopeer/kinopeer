import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProwlarrError, ProwlarrSetupError, fetchRelease, getFailingIndexers, getProwlarrStatus, searchReleases } from './client'
import { SETTING_KEYS } from '../settings/webui'
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

describe('the WebUI build', () => {
  const PROWLARR = 'http://192.168.1.20:9696'

  beforeEach(() => {
    vi.stubGlobal('__WEBUI__', true)
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('api/v2/clientdata/load')) return Response.json({ [SETTING_KEYS.prowlarr]: { url: PROWLARR, apiKey: 'k' } })
      const { pathname } = new URL(String(url))
      if (pathname === '/api/v1/search') return Response.json([])
      if (pathname === '/api/v1/indexerstatus') return Response.json([])
      if (pathname === '/api/v1/system/status') return Response.json({ version: '3.0.2.5780' })
      if (pathname === '/api/v1/indexer') return Response.json([])
      if (pathname === '/api/v1/indexer/1/download') return { type: 'opaqueredirect', ok: false, status: 0, body: null } as unknown as Response
      return new Response(null, { status: 404 })
    })
  })

  /** The paths of the calls that went to Prowlarr, none to Kinopeer's server. */
  const prowlarrPaths = () =>
    fetchMock.mock.calls.flatMap(([url]) => (String(url).startsWith(PROWLARR) ? [new URL(String(url)).pathname] : String(url).startsWith('api/v2/') ? [] : [String(url)]))

  it('calls Prowlarr from the page rather than through Kinopeer’s server', async () => {
    await searchReleases('Dune', { type: 'movie' })
    await getProwlarrStatus()
    await getFailingIndexers(1000)
    expect(prowlarrPaths()).toEqual(['/api/v1/search', '/api/v1/system/status', '/api/v1/indexer', '/api/v1/indexerstatus'])
  })

  it('asks about the failing indexers of the last ten minutes at most, as on the server build', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z'), toFake: ['Date'] })
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      const { pathname } = new URL(String(url), 'http://192.168.1.20:8080/')
      if (pathname === '/api/v1/indexerstatus') {
        return Response.json([
          { indexerId: 1, mostRecentFailure: '2026-11-22T11:49:00Z' },
          { indexerId: 2, mostRecentFailure: '2026-11-22T11:51:00Z' },
        ])
      }
      if (pathname === '/api/v1/indexer') return Response.json([{ id: 1, name: 'Indexer A', enable: true }, { id: 2, name: 'Indexer B', enable: true }])
      return answer(url, init)
    })
    await expect(getFailingIndexers(45 * 60 * 1000)).resolves.toEqual(['Indexer B'])
    vi.useRealTimers()
  })

  it('hands qBittorrent the download link when Prowlarr answers with a redirect', async () => {
    await expect(fetchRelease(RELEASE)).resolves.toEqual({ kind: 'link', uri: `${PROWLARR}/api/v1/indexer/1/download?link=A&apikey=k` })
  })
})
