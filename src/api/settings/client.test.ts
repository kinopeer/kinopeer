import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SettingsError, getServerSettings, saveDownloadDefaults, saveQbittorrentLogin, saveTmdbKey } from './client'

let fetchMock: Mock<typeof fetch>

function json(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getServerSettings', () => {
  it('reads the settings', async () => {
    json({ tmdb: { configured: true, source: 'env' } })
    await expect(getServerSettings()).resolves.toEqual({ tmdb: { configured: true, source: 'env' } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings')
  })

  it('fails when the server has no settings route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getServerSettings()).rejects.toBeInstanceOf(SettingsError)
  })
})

describe('saveTmdbKey', () => {
  it('puts the key as JSON', async () => {
    json({ tmdb: { configured: true, source: 'saved' } })
    await expect(saveTmdbKey('abc')).resolves.toEqual({ tmdb: { configured: true, source: 'saved' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/settings/tmdb')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('{"apiKey":"abc"}')
  })

  it('passes on why the server refused it', async () => {
    json({ error: 'invalid-key' }, 422)
    await expect(saveTmdbKey('bad')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })
    json({ error: 'unreachable' }, 502)
    await expect(saveTmdbKey('abc')).rejects.toMatchObject({ code: 'unreachable' })
  })
})

describe('saveQbittorrentLogin', () => {
  it('puts the login as JSON and passes refusals on', async () => {
    json({ tmdb: { configured: true, source: 'saved' }, qbittorrent: { configured: true, source: 'saved' } })
    await saveQbittorrentLogin('admin', 'p@ss')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/settings/qbittorrent')
    expect(init?.body).toBe('{"username":"admin","password":"p@ss"}')

    json({ error: 'banned' }, 429)
    await expect(saveQbittorrentLogin('admin', 'x')).rejects.toMatchObject({ status: 429, code: 'banned' })
  })
})

describe('saveDownloadDefaults', () => {
  it('patches only the given defaults, with the cookies Umbrel needs', async () => {
    json({ downloads: { startPaused: true, movieCategory: null } })
    await expect(saveDownloadDefaults({ startPaused: true, movieCategory: null })).resolves.toEqual({
      downloads: { startPaused: true, movieCategory: null },
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/settings/downloads')
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin' })
    expect(init?.body).toBe('{"startPaused":true,"movieCategory":null}')
  })

  it('fails when the server refuses them or has no such route', async () => {
    json({ error: 'storage' }, 500)
    await expect(saveDownloadDefaults({ sequential: true })).rejects.toMatchObject({ status: 500, code: 'storage' })
    fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    await expect(saveDownloadDefaults({ sequential: true })).rejects.toBeInstanceOf(SettingsError)
  })
})
