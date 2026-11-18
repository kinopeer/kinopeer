import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import {
  ONE_OFF_RETRY_MS,
  currentOneOffTorrents,
  loadOneOffTorrents,
  resetOneOffTorrents,
  subscribeOneOffTorrents,
} from './oneOffTorrents'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTorrents: vi.fn(),
}))

const getTorrents = vi.mocked(api.getTorrents)
const A = torrent('a')

beforeEach(() => {
  vi.resetAllMocks()
  resetOneOffTorrents()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadOneOffTorrents', () => {
  it('asks once for the page, and tells who listens when the list arrives', async () => {
    getTorrents.mockResolvedValue([A])
    const listener = vi.fn()
    subscribeOneOffTorrents(listener)
    loadOneOffTorrents()
    loadOneOffTorrents()
    expect(currentOneOffTorrents()).toBeUndefined()
    await vi.runAllTimersAsync()
    expect(currentOneOffTorrents()).toEqual([A])
    expect(listener).toHaveBeenCalledTimes(1)
    loadOneOffTorrents()
    expect(getTorrents).toHaveBeenCalledTimes(1)
  })

  it('stops telling a listener that unsubscribed', async () => {
    getTorrents.mockResolvedValue([A])
    const listener = vi.fn()
    subscribeOneOffTorrents(listener)()
    loadOneOffTorrents()
    await vi.runAllTimersAsync()
    expect(listener).not.toHaveBeenCalled()
  })

  it('asks again only once a failure is more than a minute old', async () => {
    getTorrents.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([A])
    loadOneOffTorrents()
    await vi.runAllTimersAsync()
    expect(currentOneOffTorrents()).toBeUndefined()

    vi.setSystemTime(Date.now() + ONE_OFF_RETRY_MS)
    loadOneOffTorrents()
    expect(getTorrents).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1)
    loadOneOffTorrents()
    await vi.runAllTimersAsync()
    expect(getTorrents).toHaveBeenCalledTimes(2)
    expect(currentOneOffTorrents()).toEqual([A])
  })

  it('ignores an answer to a load from before a reset', async () => {
    let answer!: (torrents: api.Torrent[]) => void
    getTorrents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    loadOneOffTorrents()
    resetOneOffTorrents()
    answer([A])
    await vi.runAllTimersAsync()
    expect(currentOneOffTorrents()).toBeUndefined()
  })

  it('doesn’t hold back a load after a reset for a failure from before it', async () => {
    let fail!: (error: Error) => void
    getTorrents.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    loadOneOffTorrents()
    resetOneOffTorrents()
    fail(new Error('offline'))
    await vi.runAllTimersAsync()
    getTorrents.mockResolvedValue([A])
    loadOneOffTorrents()
    await vi.runAllTimersAsync()
    expect(currentOneOffTorrents()).toEqual([A])
  })

  it('keeps a load in flight when one from before a reset settles', async () => {
    let fail!: (error: Error) => void
    getTorrents.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    loadOneOffTorrents()
    resetOneOffTorrents()
    getTorrents.mockReturnValueOnce(new Promise(() => {}))
    loadOneOffTorrents()
    fail(new Error('offline'))
    await vi.runAllTimersAsync()
    // The second load is still on its way, so nothing more is asked, and no failure stands.
    loadOneOffTorrents()
    expect(getTorrents).toHaveBeenCalledTimes(2)
  })
})
