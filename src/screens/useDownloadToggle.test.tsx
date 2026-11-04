import { act, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { STATE_LAG_MARGIN_MS, resetStateLag } from '../torrents/stateLag'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { requestKey } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { useDownloadToggle } from './useDownloadToggle'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTorrents: vi.fn(),
  toggleSequentialDownload: vi.fn(),
  toggleFirstLastPiecePrio: vi.fn(),
  getRefreshInterval: vi.fn(),
}))
const getTorrents = vi.mocked(api.getTorrents)
const toggleSequentialDownload = vi.mocked(api.toggleSequentialDownload)
const toggleFirstLastPiecePrio = vi.mocked(api.toggleFirstLastPiecePrio)
const getRefreshInterval = vi.mocked(api.getRefreshInterval)

const DUNE = torrent('dune', { added_on: 1 })
const FAILED = 'Couldn’t reach qBittorrent. Try again.'

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  resetStateLag()
  getRefreshInterval.mockResolvedValue(undefined)
  getTorrents.mockResolvedValue([DUNE])
  toggleSequentialDownload.mockResolvedValue()
  toggleFirstLastPiecePrio.mockResolvedValue()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDownloadToggle', () => {
  it('flips sequential download, and first and last pieces first, after reading the torrent', async () => {
    const { result } = renderHook(() => ({ seq: useDownloadToggle('seq_dl'), pieces: useDownloadToggle('f_l_piece_prio') }), {
      wrapper: Providers,
    })
    await act(() => result.current.seq.set(DUNE, true))
    expect(getTorrents).toHaveBeenCalledWith({ hashes: ['dune'] })
    expect(toggleSequentialDownload).toHaveBeenCalledWith(['dune'])
    await act(() => result.current.pieces.set(DUNE, true))
    expect(toggleFirstLastPiecePrio).toHaveBeenCalledWith(['dune'])
    expect(toggleSequentialDownload).toHaveBeenCalledOnce()
  })

  it('flips nothing when the torrent is that way already, as another client left it', async () => {
    getTorrents.mockResolvedValue([{ ...DUNE, seq_dl: true }])
    const { result } = renderHook(() => useDownloadToggle('seq_dl'), { wrapper: Providers })
    expect(await act(() => result.current.set(DUNE, true))).toMatchObject({ ok: true })
    expect(getTorrents).toHaveBeenCalledOnce()
    // A flip now would turn it off again.
    expect(toggleSequentialDownload).not.toHaveBeenCalled()
  })

  it('flips nothing for a torrent qBittorrent no longer has', async () => {
    getTorrents.mockResolvedValue([])
    const { result } = renderHook(() => useDownloadToggle('f_l_piece_prio'), { wrapper: Providers })
    // Not a failure: there's nothing to flip, and the page says the torrent is gone.
    expect(await act(() => result.current.set(DUNE, true))).toMatchObject({ ok: true })
    expect(getTorrents).toHaveBeenCalledOnce()
    expect(toggleFirstLastPiecePrio).not.toHaveBeenCalled()
  })

  it('shows the value being sent, busy wherever it was sent from, and doesn’t send it again', async () => {
    let answer = () => {}
    toggleSequentialDownload.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => ({ page: useDownloadToggle('seq_dl'), drawer: useDownloadToggle('seq_dl') }), {
      wrapper: Providers,
    })
    let sent: Promise<unknown> = Promise.resolve()
    act(() => {
      sent = result.current.page.set(DUNE, true)
    })
    expect(result.current.drawer.busy('dune')).toBe(true)
    expect(result.current.drawer.value(DUNE)).toBe(true)
    expect(result.current.drawer.value({ ...DUNE, hash: 'alien' })).toBe(false)
    // Pressed again before the answer: a second flip would undo the first.
    await act(async () => expect(await result.current.drawer.set(DUNE, false)).toBeUndefined())

    await act(async () => {
      answer()
      await sent
    })
    expect(toggleSequentialDownload).toHaveBeenCalledOnce()
    expect(result.current.drawer.busy('dune')).toBe(false)
    expect(result.current.drawer.value(DUNE)).toBe(false)
    // Neither the flip qBittorrent took nor the one left out is a failure.
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('keeps the new value for qBittorrent’s refresh interval, which may still report the old one', async () => {
    vi.useFakeTimers({ now: 10_000, toFake: ['Date'] })
    getRefreshInterval.mockResolvedValue(5_000)
    const { result } = renderHook(() => ({ toggle: useDownloadToggle('f_l_piece_prio'), requests: useTorrentRequests() }), {
      wrapper: Providers,
    })
    await act(() => result.current.toggle.set(DUNE, true))
    const expected = result.current.requests.getExpected().get(requestKey(REQUEST_KINDS.firstLastPieces, 'dune'))
    expect(expected).toMatchObject({ until: 10_000 + 5_000 + STATE_LAG_MARGIN_MS })
    expect(expected?.expect(DUNE)).toEqual({ ...DUNE, f_l_piece_prio: true })
  })

  it('says a failure in a toast, which the next try takes back', async () => {
    toggleSequentialDownload.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => useDownloadToggle('seq_dl'), { wrapper: Providers })
    expect(await act(() => result.current.set(DUNE, true))).toMatchObject({ ok: false })
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    act(() => void result.current.set(DUNE, true))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('says a failed read of the torrent as a failure too', async () => {
    getTorrents.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useDownloadToggle('seq_dl'), { wrapper: Providers })
    expect(await act(() => result.current.set(DUNE, true))).toMatchObject({ ok: false })
    expect(toggleSequentialDownload).not.toHaveBeenCalled()
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })
})
