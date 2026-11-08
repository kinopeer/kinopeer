import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SettingsError, getServerSettings, saveDownloadDefaults } from './client'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getServerSettings', () => {
  it('fails when the server has no settings route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getServerSettings()).rejects.toBeInstanceOf(SettingsError)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
  })
})

describe('saveDownloadDefaults', () => {
  it('fails when the server has no such route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    await expect(saveDownloadDefaults({ sequential: true })).rejects.toBeInstanceOf(SettingsError)
  })
})
