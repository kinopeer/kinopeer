import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { OFFLINE_POLL_INTERVAL_MS, POLL_INTERVAL_MS, useMainData } from './useMainData'

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
