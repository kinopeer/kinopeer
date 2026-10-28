import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedError, toggleSpeedLimitsMode } from '../api/qbittorrent'
import { EMPTY_SYNC_STATE } from './sync'
import { useAltSpeedLimits } from './useAltSpeedLimits'
import type { MainDataState } from './useMainData'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/qbittorrent')>()),
  toggleSpeedLimitsMode: vi.fn(),
}))
const toggleMock = vi.mocked(toggleSpeedLimitsMode)

const refresh = vi.fn()

/** The poll's state: `requestedAt` is when the request behind it was sent, `updatedAt` when it answered. */
interface PollState {
  offline?: boolean
  requestedAt?: number
  updatedAt?: number
}

function main(alt: boolean | undefined, { offline = false, requestedAt = 0, updatedAt = requestedAt }: PollState = {}): MainDataState {
  const server = alt === undefined ? {} : { use_alt_speed_limits: alt }
  return { data: { ...EMPTY_SYNC_STATE, server }, offline, updatedAt, requestedAt, refresh }
}

function renderAlt(initial: MainDataState) {
  return renderHook((state: MainDataState) => useAltSpeedLimits(state), { initialProps: initial })
}

afterEach(() => {
  toggleMock.mockReset()
  refresh.mockReset()
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
    const before = Date.now() - 1
    act(() => result.current.toggle())
    expect(toggleMock).toHaveBeenCalledOnce()
    expect(result.current).toMatchObject({ on: true, disabled: true })

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(result.current).toMatchObject({ on: true, disabled: false })
    // A poll that was on its way before the switch answers only now, with the old state.
    rerender(main(false, { requestedAt: before, updatedAt: Date.now() + 500 }))
    expect(result.current.on).toBe(true)

    rerender(main(true, { requestedAt: Date.now() + 1_000 }))
    expect(result.current.on).toBe(true)
    // From then on the poll decides, e.g. after a switch in qBittorrent's own UI.
    rerender(main(false, { requestedAt: Date.now() + 3_000 }))
    expect(result.current.on).toBe(false)
  })

  it('follows the first poll sent after the switch even when it disagrees', async () => {
    toggleMock.mockResolvedValue()
    const { result, rerender } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    // qBittorrent's scheduler switched the limits back.
    rerender(main(false, { requestedAt: Date.now() + 1_000 }))
    expect(result.current).toMatchObject({ on: false, disabled: false })
  })

  it('goes back to the polled state and says so when the request fails', async () => {
    toggleMock.mockRejectedValue(new Error('down'))
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    expect(result.current.on).toBe(true)
    await waitFor(() => expect(result.current).toMatchObject({ on: false, disabled: false, failed: true }))
    expect(refresh).not.toHaveBeenCalled()

    act(() => result.current.dismissFailed())
    expect(result.current.failed).toBe(false)
  })

  it('leaves an expired session to the poll, which reports it', async () => {
    toggleMock.mockRejectedValue(new UnauthorizedError())
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(result.current).toMatchObject({ on: false, failed: false })
  })
})
