import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { sharedRequests } from '../../logic/sharedRequests'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, SettingsError, forgetTmdbKey, getServerSettings, saveDownloadDefaults, saveQbittorrentLogin, saveTmdbKey } from './client'
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
