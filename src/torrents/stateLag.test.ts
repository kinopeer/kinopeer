import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { DEFAULT_REFRESH_INTERVAL_MS, STATE_LAG_MARGIN_MS, readRefreshInterval, resetStateLag, stateLag } from './stateLag'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getRefreshInterval: vi.fn(),
}))
const getRefreshInterval = vi.mocked(api.getRefreshInterval)

beforeEach(() => {
  vi.resetAllMocks()
  resetStateLag()
})

/** Lets a read that was answered settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve))

describe('stateLag', () => {
  it('is qBittorrent’s default refresh interval and a margin until the interval is read', async () => {
    getRefreshInterval.mockReturnValue(new Promise(() => {}))
    expect(stateLag()).toBe(DEFAULT_REFRESH_INTERVAL_MS + STATE_LAG_MARGIN_MS)
    readRefreshInterval()
    await settle()
    expect(stateLag()).toBe(DEFAULT_REFRESH_INTERVAL_MS + STATE_LAG_MARGIN_MS)
  })

  it('is qBittorrent’s refresh interval and a margin once read, which happens once per page', async () => {
    getRefreshInterval.mockResolvedValue(5_000)
    readRefreshInterval()
    readRefreshInterval()
    await settle()
    expect(stateLag()).toBe(5_000 + STATE_LAG_MARGIN_MS)
    readRefreshInterval()
    expect(getRefreshInterval).toHaveBeenCalledOnce()
  })

  it('keeps the default when qBittorrent doesn’t say, without asking again', async () => {
    getRefreshInterval.mockResolvedValue(undefined)
    readRefreshInterval()
    await settle()
    expect(stateLag()).toBe(DEFAULT_REFRESH_INTERVAL_MS + STATE_LAG_MARGIN_MS)
    readRefreshInterval()
    expect(getRefreshInterval).toHaveBeenCalledOnce()
  })

  it('ignores a read from before a reset', async () => {
    let answerEarlier = (_interval: number) => {}
    getRefreshInterval
      .mockReturnValueOnce(new Promise((resolve) => (answerEarlier = resolve)))
      .mockReturnValueOnce(new Promise(() => {}))
    readRefreshInterval()
    resetStateLag()
    readRefreshInterval()
    answerEarlier(5_000)
    await settle()
    expect(stateLag()).toBe(DEFAULT_REFRESH_INTERVAL_MS + STATE_LAG_MARGIN_MS)
    // The read after the reset is still on its way.
    readRefreshInterval()
    expect(getRefreshInterval).toHaveBeenCalledTimes(2)
  })

  it('reads it again the next time after a failure', async () => {
    getRefreshInterval.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(3_000)
    readRefreshInterval()
    await settle()
    expect(stateLag()).toBe(DEFAULT_REFRESH_INTERVAL_MS + STATE_LAG_MARGIN_MS)
    readRefreshInterval()
    await settle()
    expect(stateLag()).toBe(3_000 + STATE_LAG_MARGIN_MS)
  })
})
