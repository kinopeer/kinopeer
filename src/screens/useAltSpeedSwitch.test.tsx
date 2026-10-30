import { act, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { saying } from '../test/render'
import { EMPTY_SYNC_STATE } from '../torrents/sync'
import type { MainDataState } from '../torrents/useMainData'
import { useAltSpeedSwitch } from './useAltSpeedSwitch'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  toggleSpeedLimitsMode: vi.fn(),
}))
const toggle = vi.mocked(api.toggleSpeedLimitsMode)

const MAIN: MainDataState = {
  data: { ...EMPTY_SYNC_STATE, server: { use_alt_speed_limits: false } },
  offline: false,
  updatedAt: 0,
  requestedAt: 0,
  refresh: vi.fn(),
}

const FAILED = 'Couldn’t switch the speed limits. Try again.'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useAltSpeedSwitch', () => {
  it('says a failed switch in a toast, and takes it back when the switch is pressed again', async () => {
    toggle.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => useAltSpeedSwitch(MAIN), { wrapper: ToastProvider })
    act(() => result.current.toggle())
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    act(() => result.current.toggle())
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})
