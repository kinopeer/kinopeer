import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedError, toggleSpeedLimitsMode } from '../api/qbittorrent'
import { fakePoll } from '../test/render'
import { EMPTY_SYNC_STATE } from './sync'
import { useAltSpeedLimits } from './useAltSpeedLimits'
import type { MainDataState } from './useMainData'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/qbittorrent')>()),
  toggleSpeedLimitsMode: vi.fn(),
}))
const toggleMock = vi.mocked(toggleSpeedLimitsMode)

const refresh = vi.fn()
const onFailed = vi.fn()

/** The poll's state: `requestedAt` is when the request behind it was sent, `updatedAt` when it answered. */
interface PollState {
  offline?: boolean
  requestedAt?: number
  updatedAt?: number
}

function main(alt: boolean | undefined, { offline = false, requestedAt = 0, updatedAt = requestedAt }: PollState = {}): MainDataState {
  const server = alt === undefined ? {} : { use_alt_speed_limits: alt }
  return { data: { ...EMPTY_SYNC_STATE, server }, offline, updatedAt, requestedAt, refresh, poll: fakePoll().poll }
}

function renderAlt(initial: MainDataState) {
  return renderHook((state: MainDataState) => useAltSpeedLimits(state, onFailed), { initialProps: initial })
}

/** The pinned clock: qBittorrent takes a switch at NOW, polls are sent before or after it. */
const NOW = Date.UTC(2026, 9, 28, 12)

beforeEach(() => {
  // Only Date is pinned, so waitFor's own timers still run.
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  toggleMock.mockReset()
  refresh.mockReset()
  onFailed.mockReset()
})

describe('useAltSpeedLimits', () => {
  it('reads the state from the poll and has nothing to toggle before it’s known or while offline', () => {
    const { result, rerender } = renderAlt(main(undefined))
    expect(result.current).toMatchObject({ on: undefined, disabled: true })
    rerender(main(true))
    expect(result.current).toMatchObject({ on: true, disabled: false })
    rerender(main(true, { offline: true }))
    expect(result.current).toMatchObject({ on: true, disabled: true })
  })

  it('shows the new state right away and keeps it until a poll sent after the switch', async () => {
    toggleMock.mockResolvedValue()
    const { result, rerender } = renderAlt(main(false))
    act(() => result.current.toggle())
    expect(toggleMock).toHaveBeenCalledOnce()
    expect(result.current).toMatchObject({ on: true, disabled: true })

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(result.current).toMatchObject({ on: true, disabled: false })
    // A poll that was on its way before the switch answers only now, with the old state.
    rerender(main(false, { requestedAt: NOW - 1, updatedAt: NOW + 500 }))
    expect(result.current.on).toBe(true)

    rerender(main(true, { requestedAt: NOW + 1_000 }))
    expect(result.current.on).toBe(true)
    // From then on the poll decides, e.g. after a switch in qBittorrent's own UI.
    rerender(main(false, { requestedAt: NOW + 3_000 }))
    expect(result.current.on).toBe(false)
  })

  it('follows the first poll sent after the switch even when it disagrees', async () => {
    toggleMock.mockResolvedValue()
    const { result, rerender } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    // qBittorrent's scheduler switched the limits back.
    rerender(main(false, { requestedAt: NOW + 1_000 }))
    expect(result.current).toMatchObject({ on: false, disabled: false })
  })

  it('goes back to the polled state and says so when the request fails', async () => {
    toggleMock.mockRejectedValue(new Error('down'))
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    expect(result.current.on).toBe(true)
    await waitFor(() => expect(result.current).toMatchObject({ on: false, disabled: false }))
    expect(onFailed).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('says each failure, and not a switch that went through after one', async () => {
    toggleMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce()
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce())

    act(() => result.current.toggle())
    expect(result.current.on).toBe(true)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(onFailed).toHaveBeenCalledOnce()
  })

  it('leaves an expired session to the poll, which reports it', async () => {
    toggleMock.mockRejectedValue(new UnauthorizedError())
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(result.current.on).toBe(false)
    expect(onFailed).not.toHaveBeenCalled()
  })
})
