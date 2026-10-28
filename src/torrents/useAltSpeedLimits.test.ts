import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toggleSpeedLimitsMode } from '../api/qbittorrent'
import { EMPTY_SYNC_STATE } from './sync'
import { useAltSpeedLimits } from './useAltSpeedLimits'
import type { MainDataState } from './useMainData'

vi.mock('../api/qbittorrent', () => ({ toggleSpeedLimitsMode: vi.fn() }))
const toggleMock = vi.mocked(toggleSpeedLimitsMode)

const refresh = vi.fn()

function main(alt: boolean | undefined, offline = false, updatedAt = 0): MainDataState {
  const server = alt === undefined ? {} : { use_alt_speed_limits: alt }
  return { data: { ...EMPTY_SYNC_STATE, server }, offline, updatedAt, refresh }
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
    rerender(main(true, true))
    expect(result.current).toMatchObject({ on: true, disabled: true })
  })

  it('shows the new state right away and keeps it until the first poll after the request', async () => {
    toggleMock.mockResolvedValue()
    const { result, rerender } = renderAlt(main(false))
    act(() => result.current.toggle())
    expect(toggleMock).toHaveBeenCalledOnce()
    expect(result.current).toMatchObject({ on: true, disabled: true })
    // A poll answered while the request is on its way still has the old state.
    rerender(main(false, false, Date.now()))
    expect(result.current).toMatchObject({ on: true, disabled: true })

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(result.current).toMatchObject({ on: true, disabled: false })
    rerender(main(true, false, Date.now() + 1_000))
    expect(result.current.on).toBe(true)
    // From then on the poll decides, e.g. after a switch in qBittorrent's own UI.
    rerender(main(false, false, Date.now() + 3_000))
    expect(result.current.on).toBe(false)
  })

  it('follows the first poll after the request even when it disagrees', async () => {
    toggleMock.mockResolvedValue()
    const { result, rerender } = renderAlt(main(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    // qBittorrent's scheduler switched the limits back before the poll.
    rerender(main(false, false, Date.now() + 1_000))
    expect(result.current).toMatchObject({ on: false, disabled: false })
  })

  it('goes back to the polled state when the request fails', async () => {
    toggleMock.mockRejectedValue(new Error('down'))
    const { result } = renderAlt(main(false))
    act(() => result.current.toggle())
    expect(result.current.on).toBe(true)
    await waitFor(() => expect(result.current).toMatchObject({ on: false, disabled: false }))
    expect(refresh).not.toHaveBeenCalled()
  })
})
