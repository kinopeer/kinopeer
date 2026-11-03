import { act, cleanup, render, renderHook } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { MainDataProvider } from './MainDataProvider'
import { TorrentRequestsProvider } from './TorrentRequestsProvider'
import { OFFLINE_POLL_INTERVAL_MS, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, useFreeSpace, useMainData } from './useMainData'
import { useTorrentRequests } from './useTorrentRequests'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getMainData: vi.fn() }
})

const getMainData = vi.mocked(api.getMainData)

/** A request that hangs, as fetch does, failing only when its signal aborts. */
const hang = (_rid?: number, signal?: AbortSignal) =>
  new Promise<api.MainData>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))

/** Hides or shows the page, as switching tabs does. */
function setHidden(hidden: boolean) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
})

afterEach(() => {
  // Unmount while the clock is still fake and let the stores' idle stop run, so no store from this
  // test still listens to `online` or `visibilitychange` in the next one.
  cleanup()
  vi.advanceTimersByTime(0)
  vi.useRealTimers()
  // The page's visibility (`setHidden`).
  vi.restoreAllMocks()
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
    expect(getMainData).toHaveBeenLastCalledWith(1, expect.any(AbortSignal))
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

  it('gives up a poll that hangs, shows offline and polls again', async () => {
    getMainData
      .mockResolvedValueOnce({ rid: 1, full_update: true, torrents: { a: { name: 'A' } } })
      .mockImplementationOnce(hang)
      .mockResolvedValue({ rid: 2 })
    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(2)

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1))
    expect(result.current.offline).toBe(false)
    expect(result.current.poll.getPollState().inFlight).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(result.current.offline).toBe(true)
    expect(result.current.data?.torrents.a.name).toBe('A')
    expect(result.current.poll.getPollState().inFlight).toBe(false)

    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(3)
    expect(result.current.offline).toBe(false)
  })

  it('gives up a poll that hangs when the device comes back online and polls again at once', async () => {
    getMainData
      .mockResolvedValueOnce({ rid: 1, full_update: true, torrents: { a: { name: 'A' } } })
      .mockImplementationOnce(hang)
      .mockResolvedValue({ rid: 2, torrents: { a: { name: 'B' } } })
    const shown: boolean[] = []
    const { result } = renderHook(() => {
      const main = useMainData(vi.fn())
      shown.push(main.offline)
      return main
    })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new Event('online'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(3)
    expect(result.current.data?.torrents.a.name).toBe('B')
    // Given up, not failed: the screens never said qBittorrent stopped answering.
    expect(shown).not.toContain(true)
  })

  it('doesn’t poll while the page is hidden, and polls as soon as it’s back', async () => {
    getMainData.mockResolvedValue({ rid: 1 })
    renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => setHidden(true))
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
    expect(getMainData).toHaveBeenCalledTimes(1)

    act(() => setHidden(false))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('gives up a poll in flight when the page is hidden, without going offline, and polls when it’s back', async () => {
    getMainData.mockImplementationOnce(hang).mockResolvedValue({ rid: 1 })
    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    const [[, signal]] = getMainData.mock.calls

    act(() => setHidden(true))
    expect(signal?.aborted).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS))
    expect(result.current.offline).toBe(false)
    expect(result.current.poll.getPollState().inFlight).toBe(false)
    // Nothing polls while hidden, the device coming back online included.
    window.dispatchEvent(new Event('online'))
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(1)

    act(() => setHidden(false))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(2)
    expect(result.current.data).not.toBeNull()
  })

  it('doesn’t time out a poll answered in time', async () => {
    const signals: (AbortSignal | undefined)[] = []
    getMainData.mockImplementation(async (_rid, signal) => {
      signals.push(signal)
      return { rid: 1 }
    })
    const { result } = renderHook(() => useMainData(vi.fn()))
    await act(() => vi.advanceTimersByTimeAsync(0))
    // Past the first poll's timeout, which its answer cancelled.
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS))
    expect(signals[0]?.aborted).toBe(false)
    expect(result.current.offline).toBe(false)
  })

  it('says whether a poll is in flight, apart from the data, so a request going out renders no screen', async () => {
    let answer: (data: api.MainData) => void = () => {}
    getMainData.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useMainData(vi.fn())
    })
    const { poll } = result.current
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(poll.getPollState()).toEqual({ inFlight: true, offline: false, updatedAt: null })

    await act(async () => answer({ rid: 1, full_update: true }))
    const answeredAt = Date.now()
    expect(poll.getPollState()).toEqual({ inFlight: false, offline: false, updatedAt: answeredAt })
    const settled = renders

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(poll.getPollState()).toEqual({ inFlight: true, offline: false, updatedAt: answeredAt })
    expect(renders).toBe(settled)
    expect(result.current.poll).toBe(poll)
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

describe('useFreeSpace', () => {
  it('polls on its own outside a provider and renders only when the free space changes', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true, server_state: { free_space_on_disk: 40e9, dl_info_speed: 1 } })
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useFreeSpace()
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toBe(40e9)
    const settled = renders

    getMainData.mockResolvedValue({ rid: 2, server_state: { dl_info_speed: 2 } })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(2)
    expect(renders).toBe(settled)

    getMainData.mockResolvedValue({ rid: 3, server_state: { free_space_on_disk: 30e9 } })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(result.current).toBe(30e9)
  })

  it('shares the provider’s poll', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true, server_state: { free_space_on_disk: 40e9 } })
    const wrapper = ({ children }: { children: ReactNode }) => <MainDataProvider onUnauthorized={vi.fn()}>{children}</MainDataProvider>
    const { result } = renderHook(() => [useMainData(), useFreeSpace()] as const, { wrapper })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(1)
    expect(result.current[1]).toBe(40e9)
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
    expect(getMainData).toHaveBeenLastCalledWith(1, expect.any(AbortSignal))
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
      // A request that holds nothing: the poll after it says what qBittorrent has.
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

  it('keeps the state over the polls sent within the request’s hold, then leaves the word to qBittorrent', async () => {
    const downloading = { rid: 1, full_update: true, torrents: { a: { name: 'A', state: 'downloading' as const } } }
    // qBittorrent reports a pause only at its next refresh: until then it answers with nothing new.
    getMainData.mockResolvedValueOnce(downloading).mockResolvedValue({ rid: 1 })
    const { result } = renderHook(() => ({ main: useMainData(), requests: useTorrentRequests() }), { wrapper: Providers })
    await act(() => vi.advanceTimersByTimeAsync(0))

    await act(() =>
      result.current.requests.send('pause', result.current.main.data!.torrents.a, false, () => Promise.resolve(), {
        expect: (torrent) => ({ ...torrent, state: 'stoppedDL' }),
        hold: () => POLL_INTERVAL_MS + 500,
      }),
    )
    // The poll the request asked for, and the next one, are sent within the hold.
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getMainData).toHaveBeenCalledTimes(2)
    expect(result.current.main.data?.torrents.a.state).toBe('stoppedDL')
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(3)
    expect(result.current.main.data?.torrents.a.state).toBe('stoppedDL')

    // Still downloading in the first poll sent after the hold: that's qBittorrent's word (its
    // scheduler started it again).
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(getMainData).toHaveBeenCalledTimes(4)
    expect(result.current.main.data?.torrents.a.state).toBe('downloading')
  })
})
