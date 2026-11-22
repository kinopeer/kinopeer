import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { sharedRequests } from '../../logic/sharedRequests'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, SettingsError, findAddresses, forgetTmdbKey, getServerSettings, saveDownloadDefaults, saveQbittorrentLogin, saveTmdbKey } from './client'
import type { ServerSettings } from './types'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('getServerSettings', () => {
  it('fails when the server has no settings route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getServerSettings()).rejects.toBeInstanceOf(SettingsError)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
  })
})

describe('a check the server couldn’t finish', () => {
  const unreachable = (body: object) => Response.json(body, { status: 502 })

  it('passes on why the service didn’t answer (#508)', async () => {
    fetchMock.mockResolvedValueOnce(unreachable({ error: 'unreachable', failure: 'refused' }))
    await expect(saveQbittorrentLogin('admin', 'x')).rejects.toMatchObject({ status: 502, code: 'unreachable', failure: 'refused' })
  })

  it.each([
    ['none', { error: 'unreachable' }],
    ['one this app doesn’t know', { error: 'unreachable', failure: 'solar-flare' }],
  ])('names no cause when the server names %s', async (_, body) => {
    fetchMock.mockResolvedValueOnce(unreachable(body))
    const error = await saveQbittorrentLogin('admin', 'x').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'unreachable' })
    expect((error as SettingsError).failure).toBeUndefined()
  })
})

describe('the hints for Kinopeer in a container (#509)', () => {
  it('passes on the host’s address for localhost, and where qBittorrent sees Kinopeer', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'not-qbittorrent', container: { hostAddress: 'http://host.docker.internal:8080' } }, { status: 502 }))
    await expect(saveQbittorrentLogin('', '', 'http://localhost:8080')).rejects.toMatchObject({
      code: 'not-qbittorrent',
      container: { hostAddress: 'http://host.docker.internal:8080' },
    })
    const source = { address: '172.18.0.5', subnet: '172.18.0.0/16' }
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'invalid-credentials', source }, { status: 422 }))
    await expect(saveQbittorrentLogin('', '')).rejects.toMatchObject({ code: 'invalid-credentials', source })
  })

  it('takes neither in a shape the server doesn’t send', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'invalid-credentials', container: { hostAddress: 'javascript:x' }, source: { address: 'x' } }, { status: 422 }),
    )
    const error = (await saveQbittorrentLogin('', '').catch((caught: unknown) => caught)) as SettingsError
    expect([error.container, error.source]).toEqual([undefined, undefined])
  })
})

describe('saveDownloadDefaults', () => {
  it('fails when the server has no such route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    await expect(saveDownloadDefaults({ sequential: true })).rejects.toBeInstanceOf(SettingsError)
  })
})

describe('a change saved on the server', () => {
  const settings = (configured: boolean): ServerSettings => ({
    tmdb: { configured, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: null,
  })
  const answer = (body: ServerSettings) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

  it.each([
    ['a save', () => saveTmdbKey('key')],
    ['a forget', () => forgetTmdbKey()],
  ])('keeps the settings %s answers with as the page’s, in place of the ones from before it (#382)', async (_name, change) => {
    sharedRequests.set(SERVER_SETTINGS_KEY, settings(false))
    fetchMock.mockResolvedValueOnce(answer(settings(true)))
    await change()
    expect(sharedRequests.peek(SERVER_SETTINGS_KEY, SERVER_SETTINGS_FRESH_MS)).toEqual({ data: settings(true) })
  })

  it('keeps the page’s settings when a save fails', async () => {
    sharedRequests.set(SERVER_SETTINGS_KEY, settings(false))
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid-key"}', { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await expect(saveTmdbKey('key')).rejects.toBeInstanceOf(SettingsError)
    expect(sharedRequests.peek(SERVER_SETTINGS_KEY, SERVER_SETTINGS_FRESH_MS)).toEqual({ data: settings(false) })
  })
})

describe('findAddresses (#511)', () => {
  it('asks the server to look for the service and gives the addresses it found', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ addresses: ['http://qbittorrent:8080', 7, 'http://192.168.1.20:8080'] }))
    expect(await findAddresses('qbittorrent')).toEqual(['http://qbittorrent:8080', 'http://192.168.1.20:8080'])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings/qbittorrent/find')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    fetchMock.mockResolvedValueOnce(Response.json({}))
    expect(await findAddresses('prowlarr')).toEqual([])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/settings/prowlarr/find')
  })

  it('looks for Prowlarr from the page in the WebUI build, asking Kinopeer’s server nothing', async () => {
    vi.stubGlobal('__WEBUI__', true)
    vi.stubGlobal('location', new URL('http://192.168.1.20:8080/'))
    fetchMock.mockImplementation(async (url) => new Response(null, { status: new URL(String(url)).hostname === 'prowlarr' ? 401 : 404 }))
    expect(await findAddresses('prowlarr')).toEqual(['http://prowlarr:9696'])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/settings/prowlarr/find')
    // It asks for no qBittorrent address there, and looks for none.
    fetchMock.mockClear()
    expect(await findAddresses('qbittorrent')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails with the server’s refusal, or an answer that isn’t its', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'auth-off' }, { status: 409 }))
    await expect(findAddresses('prowlarr')).rejects.toMatchObject({ status: 409, code: 'auth-off' })
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(findAddresses('prowlarr')).rejects.toBeInstanceOf(SettingsError)
  })
})
