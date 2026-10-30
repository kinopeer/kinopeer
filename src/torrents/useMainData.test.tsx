import { act, render, renderHook } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { MainDataProvider } from './MainDataProvider'
import { TorrentRequestsProvider } from './TorrentRequestsProvider'
import { OFFLINE_POLL_INTERVAL_MS, POLL_INTERVAL_MS, useMainData } from './useMainData'
import { useTorrentRequests } from './useTorrentRequests'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getMainData: vi.fn() }
})

const getMainData = vi.mocked(api.getMainData)

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMainData', () => {
  it('polls with the last response id and merges the deltas', async () => {
    getMainData
      .mockResolvedValueOnce({ rid: 1, full_update: true, torrents: { a: { name: 'A', progress: 0 } } })
      .mockResolvedValueOnce({ rid: 2, torrents: { a: { progress: 0.5 } } })

    const { result } = renderHook(() => useMainData(vi.fn()))
    expect(result.current.data).toBeNull()

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.data?.torrents.a.progress).toBe(0)

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenLastCalledWith(1)
    expect(result.current.data?.torrents.a).toEqual({ hash: 'a', name: 'A', progress: 0.5 })
  })

  it('keeps the last state while offline and recovers', async () => {
    getMainData
      .mockResolvedValueOnce({ rid: 1, full_update: true, torrents: { a: { name: 'A' } } })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ rid: 2 })

    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(result.current.offline).toBe(true)
    expect(result.current.data?.torrents.a.name).toBe('A')

    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_POLL_INTERVAL_MS))
    expect(result.current.offline).toBe(false)
  })

  it('polls right away on refresh', async () => {
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ rid: 1 })
    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.offline).toBe(true)

    await act(async () => result.current.refresh())
    expect(result.current.offline).toBe(false)
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('polls again as soon as the poll in flight is answered when refreshed meanwhile, since that one went out before', async () => {
    let answer: (data: api.MainData) => void = () => {}
    getMainData.mockReturnValueOnce(new Promise((resolve) => (answer = resolve))).mockResolvedValue({ rid: 2 })
    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => result.current.refresh())
    expect(getMainData).toHaveBeenCalledTimes(1)

    await act(async () => answer({ rid: 1, full_update: true }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    // Not at the next tick, 2 s later.
    expect(getMainData).toHaveBeenCalledTimes(2)
    // Then back to the usual interval.
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1))
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('says when the request behind the data was sent', async () => {
    let answer: (data: api.MainData) => void = () => {}
    getMainData.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useMainData(vi.fn()))
    expect(result.current.requestedAt).toBeNull()
    const sentAt = Date.now()

    await act(() => vi.advanceTimersByTimeAsync(500))
    await act(async () => answer({ rid: 1, full_update: true }))
    expect(result.current.requestedAt).toBe(sentAt)
    expect(result.current.updatedAt).toBe(sentAt + 500)
  })

  it('reports an expired session once and stops', async () => {
    getMainData.mockRejectedValue(new api.UnauthorizedError())
    const onUnauthorized = vi.fn()
    renderHook(() => useMainData(onUnauthorized))

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(getMainData).toHaveBeenCalledTimes(1)
  })

  it('stops polling on unmount', async () => {
    getMainData.mockResolvedValue({ rid: 1 })
    const { unmount } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(getMainData).toHaveBeenCalledTimes(1)
  })
})

describe('MainDataProvider', () => {
  const provider = (onUnauthorized: () => void) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <MainDataProvider onUnauthorized={onUnauthorized}>{children}</MainDataProvider>
    }

  it('shares one poll between everyone under it', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { a: { name: 'A' } } })
    const { result } = renderHook(() => [useMainData(), useMainData()], { wrapper: provider(vi.fn()) })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(1)
    expect(result.current[0].data).toBe(result.current[1].data)

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('polls only while someone uses it, and starts again from the last state', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { a: { name: 'A' } } })
    let seen: string | undefined
    function User() {
      const name = useMainData().data?.torrents.a.name
      useEffect(() => {
        seen = name
      }, [name])
      return null
    }
    const app = (on: boolean) => <MainDataProvider onUnauthorized={vi.fn()}>{on && <User />}</MainDataProvider>
    const { rerender } = render(app(true))
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender(app(false))
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
    expect(getMainData).toHaveBeenCalledTimes(1)

    seen = undefined
    rerender(app(true))
    expect(seen).toBe('A')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(2)
    expect(getMainData).toHaveBeenLastCalledWith(1)
  })

  it('reports an expired session to the provider’s handler', async () => {
    getMainData.mockRejectedValue(new api.UnauthorizedError())
    const onUnauthorized = vi.fn()
    renderHook(() => useMainData(), { wrapper: provider(onUnauthorized) })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('useMainData under a TorrentRequestsProvider', () => {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MainDataProvider onUnauthorized={vi.fn()}>
        <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
      </MainDataProvider>
    )
  }

  it('shows the state a request expects until a poll sent after qBittorrent took it, which has the final word', async () => {
    const downloading = { rid: 1, full_update: true, torrents: { a: { name: 'A', state: 'downloading' as const } } }
    let answerEarlier = () => {}
    getMainData
      .mockResolvedValueOnce(downloading)
      .mockReturnValueOnce(new Promise((resolve) => (answerEarlier = () => resolve(downloading))))
      // qBittorrent's scheduler started it again: the poll after the request says so.
      .mockResolvedValueOnce(downloading)
    const { result } = renderHook(() => ({ main: useMainData(), requests: useTorrentRequests() }), { wrapper: Providers })
    await act(() => vi.advanceTimersByTimeAsync(0))

    // A poll goes out, then qBittorrent takes a pause before that poll is answered.
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(2)
    let pause = () => {}
    const sent = result.current.requests.send('pause', result.current.main.data!.torrents.a, false, () => new Promise((resolve) => (pause = resolve)), {
      expect: (torrent) => ({ ...torrent, state: 'stoppedDL' }),
    })
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(result.current.main.data?.torrents.a.state).toBe('downloading')
    await act(async () => {
      pause()
      await sent
    })
    expect(result.current.main.data?.torrents.a.state).toBe('stoppedDL')

    // The poll sent before is answered with the old state, which the expected one stays over.
    await act(async () => answerEarlier())
    expect(result.current.main.data?.torrents.a.state).toBe('stoppedDL')
    // The poll the request asked for goes out once that one is answered, and decides.
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(3)
    expect(result.current.main.data?.torrents.a.state).toBe('downloading')
  })
})
