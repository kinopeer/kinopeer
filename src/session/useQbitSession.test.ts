import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import * as settings from '../api/settings'
import { useQbitSession } from './useQbitSession'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getAppVersion: vi.fn() }
})
vi.mock('../api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof settings>()
  return { ...actual, saveQbittorrentLogin: vi.fn() }
})

const getAppVersion = vi.mocked(api.getAppVersion)
const login = vi.mocked(settings.saveQbittorrentLogin)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useQbitSession', () => {
  it('is connected when qBittorrent answers (the server’s login or auth bypass)', async () => {
    getAppVersion.mockResolvedValue('v5.2.4')
    const { result } = renderHook(() => useQbitSession())

    expect(result.current.session).toEqual({ status: 'checking' })
    await waitFor(() => expect(result.current.session).toEqual({ status: 'connected', version: 'v5.2.4' }))
  })

  it('asks to sign in when there is no session', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'signed-out' }))
  })

  it('reports qBittorrent as unreachable on network or proxy errors', async () => {
    getAppVersion.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'unreachable' }))

    getAppVersion.mockResolvedValue('v5.2.4')
    await act(() => result.current.recheck())
    expect(result.current.session).toEqual({ status: 'connected', version: 'v5.2.4' })
  })

  it('saves the login on the server and connects', async () => {
    getAppVersion.mockRejectedValueOnce(new api.UnauthorizedError()).mockResolvedValue('v5.2.4')
    login.mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'saved' }, downloads: null })
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await act(() => result.current.signIn('admin', 'secret'))
    expect(login).toHaveBeenCalledWith('admin', 'secret')
    expect(result.current.session).toEqual({ status: 'connected', version: 'v5.2.4' })
  })

  it('stays signed out when the server took the login but qBittorrent still refuses it', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    login.mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'saved' }, downloads: null })
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await expect(act(() => result.current.signIn('admin', 'secret'))).rejects.toBeInstanceOf(api.UnauthorizedError)
    expect(result.current.session).toEqual({ status: 'signed-out' })
  })

  it('passes login errors through and stays signed out', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    login.mockRejectedValue(new settings.SettingsError(422, 'invalid-credentials'))
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await expect(act(() => result.current.signIn('admin', 'wrong'))).rejects.toMatchObject({
      code: 'invalid-credentials',
    })
    expect(result.current.session).toEqual({ status: 'signed-out' })
  })
})
