import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import * as settings from '../api/settings'
import { sharedRequests } from '../logic/sharedRequests'
import { qbittorrentDown } from '../test/render'
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

/** The server's settings once it saved the login. */
const SAVED: settings.ServerSettings = { tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'saved', address: { source: 'env' } }, downloads: null }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useQbitSession', () => {
  it('is connected when qBittorrent answers (the server’s login or auth bypass)', async () => {
    getAppVersion.mockResolvedValue('5.2.4')
    const { result } = renderHook(() => useQbitSession())

    expect(result.current.session).toEqual({ status: 'checking' })
    await waitFor(() => expect(result.current.session).toEqual({ status: 'connected', version: '5.2.4' }))
  })

  it('keeps the version for the page’s other callers, and asks anew on each check, a kept answer there or not (#382)', async () => {
    getAppVersion.mockResolvedValueOnce('5.2.4').mockResolvedValueOnce('5.2.5')
    sharedRequests.set(api.APP_VERSION_KEY, '5.0.0')
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'connected', version: '5.2.4' }))
    expect(sharedRequests.peek(api.APP_VERSION_KEY, api.APP_VERSION_FRESH_MS)).toEqual({ data: '5.2.4' })

    await act(() => result.current.recheck())
    expect(result.current.session).toEqual({ status: 'connected', version: '5.2.5' })
    expect(getAppVersion).toHaveBeenCalledTimes(2)
  })

  it('asks to sign in when there is no session', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'signed-out' }))
  })

  it('asks for an address when the server has none, then saves it with the login and connects', async () => {
    getAppVersion.mockRejectedValueOnce(new api.NoAddressError()).mockResolvedValue('5.2.4')
    login.mockResolvedValue(SAVED)
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'no-address' }))

    let answer: unknown
    await act(async () => {
      answer = await result.current.signIn('', '', 'http://192.168.1.10:8080')
    })
    expect(login).toHaveBeenCalledWith('', '', 'http://192.168.1.10:8080')
    expect(result.current.session).toEqual({ status: 'connected', version: '5.2.4' })
    // The server's settings, which Settings shows after a save.
    expect(answer).toBe(SAVED)
  })

  it('says who did not answer the check: Kinopeer on a network error, qBittorrent on the bridge’s failure', async () => {
    getAppVersion.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'unreachable', who: 'unreached' }))

    getAppVersion.mockRejectedValue(qbittorrentDown())
    await act(() => result.current.recheck())
    expect(result.current.session).toEqual({ status: 'unreachable', who: 'qbittorrent' })

    getAppVersion.mockResolvedValue('5.2.4')
    await act(() => result.current.recheck())
    expect(result.current.session).toEqual({ status: 'connected', version: '5.2.4' })
  })
  it('keeps why qBittorrent didn’t answer the check, where the server could tell (#508)', async () => {
    getAppVersion.mockRejectedValue(new api.QbittorrentError('qBittorrent responded 502', 502, 'refused'))
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toStrictEqual({ status: 'unreachable', who: 'qbittorrent', failure: 'refused' }))
  })


  it('saves the login on the server and connects', async () => {
    getAppVersion.mockRejectedValueOnce(new api.UnauthorizedError()).mockResolvedValue('5.2.4')
    login.mockResolvedValue(SAVED)
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await act(() => result.current.signIn('admin', 'secret'))
    expect(login).toHaveBeenCalledWith('admin', 'secret', undefined)
    expect(result.current.session).toEqual({ status: 'connected', version: '5.2.4' })
  })

  it('says when qBittorrent is older than Kinopeer works with (#359)', async () => {
    getAppVersion.mockResolvedValue('4.5.5')
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session).toEqual({ status: 'unsupported', version: '4.5.5' }))

    getAppVersion.mockResolvedValue('4.6.0')
    await act(() => result.current.recheck())
    expect(result.current.session).toEqual({ status: 'connected', version: '4.6.0' })
  })

  it('signs in to a qBittorrent too old, then says so rather than refusing the login', async () => {
    getAppVersion.mockRejectedValueOnce(new api.UnauthorizedError()).mockResolvedValue('4.4.3')
    login.mockResolvedValue(SAVED)
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await act(() => result.current.signIn('admin', 'secret'))
    expect(result.current.session).toEqual({ status: 'unsupported', version: '4.4.3' })
  })

  it('stays signed out when the server took the login but qBittorrent still refuses it', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    login.mockResolvedValue(SAVED)
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
