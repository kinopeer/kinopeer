import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { TorrentFile } from '../api/qbittorrent'
import { FILES_POLL_INTERVAL_MS } from './pollIntervals'
import { useTorrentFiles } from './useTorrentFiles'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTorrentFiles: vi.fn(),
}))

const getTorrentFiles = vi.mocked(api.getTorrentFiles)

const FILES: TorrentFile[] = [
  { index: 0, name: 'Dune/Dune.mkv', size: 19e9, progress: 0.4, priority: 1 },
  { index: 1, name: 'Dune/Extras.mkv', size: 1e9, progress: 0, priority: 0 },
]

/** Lets the pending request answer and the hook render it. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0))
/** Runs the next poll. */
const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS))

/** Pretends the tab was hidden or shown. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  getTorrentFiles.mockResolvedValue(FILES)
})

afterEach(() => {
  vi.useRealTimers()
  setHidden(false)
})

describe('useTorrentFiles', () => {
  it('loads the files, then asks again every few seconds', async () => {
    const { result } = renderHook(() => useTorrentFiles('dune'))
    expect(result.current.files).toBeUndefined()
    await settle()
    expect(result.current.files).toEqual(FILES)
    expect(result.current.failed).toBe(false)
    expect(getTorrentFiles).toHaveBeenCalledWith('dune')

    await nextPoll()
    await nextPoll()
    expect(getTorrentFiles).toHaveBeenCalledTimes(3)
  })

  it('stops polling while the tab is hidden and asks right away when it shows again', async () => {
    renderHook(() => useTorrentFiles('dune'))
    await settle()
    setHidden(true)
    await nextPoll()
    await nextPoll()
    expect(getTorrentFiles).toHaveBeenCalledTimes(1)

    setHidden(false)
    await settle()
    expect(getTorrentFiles).toHaveBeenCalledTimes(2)
    await nextPoll()
    expect(getTorrentFiles).toHaveBeenCalledTimes(3)
  })

  it('keeps the last list and says so when a poll fails, until the next answer', async () => {
    const { result } = renderHook(() => useTorrentFiles('dune'))
    await settle()
    getTorrentFiles.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await nextPoll()
    expect(result.current.failed).toBe(true)
    expect(result.current.files).toEqual(FILES)

    await nextPoll()
    expect(result.current.failed).toBe(false)
  })

  it('says when the poll whose answer it shows was sent', async () => {
    vi.setSystemTime(1_000)
    const { result } = renderHook(() => useTorrentFiles('dune'))
    await settle()
    expect(result.current.requestedAt).toBe(1_000)
    await nextPoll()
    expect(result.current.requestedAt).toBe(1_000 + FILES_POLL_INTERVAL_MS)
  })

  it('asks nothing while disabled, right away once enabled, and keeps the last list when disabled again', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useTorrentFiles('dune', enabled), {
      initialProps: { enabled: false },
    })
    await nextPoll()
    expect(getTorrentFiles).not.toHaveBeenCalled()
    expect(result.current.files).toBeUndefined()

    rerender({ enabled: true })
    await settle()
    expect(result.current.files).toEqual(FILES)
    await nextPoll()
    expect(getTorrentFiles).toHaveBeenCalledTimes(2)

    rerender({ enabled: false })
    await nextPoll()
    await nextPoll()
    expect(getTorrentFiles).toHaveBeenCalledTimes(2)
    expect(result.current.files).toEqual(FILES)
  })

  it('shows nothing of the previous torrent while another one loads', async () => {
    const { result, rerender } = renderHook(({ hash }) => useTorrentFiles(hash), { initialProps: { hash: 'dune' } })
    await settle()
    const other = [{ index: 0, name: 'Alien.mkv', size: 1e9, progress: 1, priority: 1 as const }]
    getTorrentFiles.mockResolvedValue(other)
    rerender({ hash: 'alien' })
    expect(result.current.files).toBeUndefined()
    await settle()
    expect(result.current.files).toEqual(other)
    expect(getTorrentFiles).toHaveBeenLastCalledWith('alien')
  })
})
