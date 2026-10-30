import { act, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { usePauseResume } from './usePauseResume'
import type { ActionWatcher } from './useTorrentAction'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  startTorrents: vi.fn(),
  stopTorrents: vi.fn(),
}))
const startTorrents = vi.mocked(api.startTorrents)
const stopTorrents = vi.mocked(api.stopTorrents)

const DUNE = torrent('dune', { state: 'downloading', added_on: 1 })
const ALIEN = torrent('alien', { state: 'stoppedDL', added_on: 2 })
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
})

describe('usePauseResume', () => {
  it('pauses a running torrent and resumes a stopped one, and several torrents in one request', async () => {
    startTorrents.mockResolvedValue()
    stopTorrents.mockResolvedValue()
    const { result } = renderHook(() => usePauseResume(), { wrapper: Providers })
    await act(() => result.current.toggle(DUNE))
    expect(stopTorrents).toHaveBeenCalledWith(['dune'])
    await act(() => result.current.toggle(ALIEN))
    expect(startTorrents).toHaveBeenCalledWith(['alien'])
    await act(() => result.current.set([DUNE, ALIEN], true))
    expect(startTorrents).toHaveBeenLastCalledWith(['dune', 'alien'])
  })

  it('shows a pause busy to every place under one provider, and doesn’t send it again from another', async () => {
    let answer = () => {}
    stopTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => ({ row: usePauseResume(), drawer: usePauseResume() }), { wrapper: Providers })
    let sent: Promise<unknown> = Promise.resolve()
    act(() => {
      sent = result.current.row.toggle(DUNE)
    })
    expect(result.current.drawer.busy('dune')).toBe(true)
    expect(result.current.drawer.busy('alien')).toBe(false)
    // A second pause could land after a resume sent meanwhile, or the other way round.
    await act(async () => expect(await result.current.drawer.toggle(DUNE)).toBeUndefined())
    expect(stopTorrents).toHaveBeenCalledOnce()

    await act(async () => {
      answer()
      await sent
    })
    expect(result.current.drawer.busy('dune')).toBe(false)
  })

  it('says a failure in a toast, which the next try takes back', async () => {
    stopTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => usePauseResume(), { wrapper: Providers })
    await act(() => result.current.toggle(DUNE))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    act(() => void result.current.toggle(DUNE))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('leaves how it went to the place that shows the torrent, wherever it was sent from', async () => {
    stopTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce()
    const settled = vi.fn<ActionWatcher['settled']>()
    const { result } = renderHook(() => ({ row: usePauseResume(), menu: usePauseResume({ torrent: DUNE, settled }) }), {
      wrapper: Providers,
    })
    expect(await act(() => result.current.row.toggle(DUNE))).toMatchObject({ ok: false, showing: true })
    expect(settled).toHaveBeenLastCalledWith({ ok: false, error: expect.any(TypeError) })
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    await act(() => result.current.row.toggle(DUNE))
    expect(settled).toHaveBeenLastCalledWith({ ok: true })
    // Not another torrent that took its hash.
    await act(() => result.current.row.toggle({ ...DUNE, added_on: 9 }))
    expect(settled).toHaveBeenCalledTimes(2)
  })
})
