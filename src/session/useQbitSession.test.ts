import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { useQbitSession } from './useQbitSession'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getAppVersion: vi.fn(), login: vi.fn(), logout: vi.fn() }
})

const getAppVersion = vi.mocked(api.getAppVersion)
const login = vi.mocked(api.login)
const logout = vi.mocked(api.logout)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useQbitSession', () => {
  it('is connected when qBittorrent answers without a login (auth bypass or live session)', async () => {
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

  it('signs in and connects', async () => {
    getAppVersion.mockRejectedValueOnce(new api.UnauthorizedError()).mockResolvedValue('v5.2.4')
    login.mockResolvedValue()
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await act(() => result.current.signIn('admin', 'secret'))
    expect(login).toHaveBeenCalledWith('admin', 'secret')
    expect(result.current.session).toEqual({ status: 'connected', version: 'v5.2.4' })
  })

  it('passes login errors through and stays signed out', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    login.mockRejectedValue(new api.InvalidCredentialsError())
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('signed-out'))

    await expect(act(() => result.current.signIn('admin', 'wrong'))).rejects.toBeInstanceOf(
      api.InvalidCredentialsError,
    )
    expect(result.current.session).toEqual({ status: 'signed-out' })
  })

  it('signs out even if the logout request fails', async () => {
    getAppVersion.mockResolvedValue('v5.2.4')
    logout.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useQbitSession())
    await waitFor(() => expect(result.current.session.status).toBe('connected'))

    await act(() => result.current.signOut())
    expect(result.current.session).toEqual({ status: 'signed-out' })
  })
})
