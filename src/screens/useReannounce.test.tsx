import { act, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { useReannounce } from './useReannounce'
import type { ActionWatcher } from './useTorrentAction'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  reannounceTorrents: vi.fn(),
}))
const reannounceTorrents = vi.mocked(api.reannounceTorrents)

const DUNE = torrent('dune', { state: 'downloading', added_on: 1 })
const FAILED = 'Couldn’t reach qBittorrent. Try again.'
const REANNOUNCED = 'Announced to the trackers'

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

describe('useReannounce', () => {
  it('reannounces a torrent and says so in a toast', async () => {
    reannounceTorrents.mockResolvedValue()
    const { result } = renderHook(() => useReannounce(), { wrapper: Providers })
    await act(() => result.current.reannounce(DUNE))
    expect(reannounceTorrents).toHaveBeenCalledWith(['dune'])
    expect(screen.getByRole('status', { name: saying(REANNOUNCED) })).toBeInTheDocument()
  })

  it('shows a reannounce busy to every place under one provider, and doesn’t send it again from another', async () => {
    let answer = () => {}
    reannounceTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => ({ downloads: useReannounce(), drawer: useReannounce() }), { wrapper: Providers })
    let sent: Promise<unknown> = Promise.resolve()
    act(() => {
      sent = result.current.downloads.reannounce(DUNE)
    })
    expect(result.current.drawer.busy('dune')).toBe(true)
    expect(result.current.drawer.busy('alien')).toBe(false)
    await act(async () => expect(await result.current.drawer.reannounce(DUNE)).toBeUndefined())
    expect(reannounceTorrents).toHaveBeenCalledOnce()

    await act(async () => {
      answer()
      await sent
    })
    expect(result.current.drawer.busy('dune')).toBe(false)
  })

  it('says a failure nothing showed in a toast, which the next try takes back', async () => {
    reannounceTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => useReannounce(), { wrapper: Providers })
    await act(() => result.current.reannounce(DUNE))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    act(() => void result.current.reannounce(DUNE))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('leaves a failure to the place that shows the torrent, wherever it was sent from', async () => {
    reannounceTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce()
    const settled = vi.fn<ActionWatcher['settled']>()
    const { result } = renderHook(
      () => ({ downloads: useReannounce(), menu: useReannounce({ torrents: [DUNE], settled }) }),
      { wrapper: Providers },
    )
    expect(await act(() => result.current.downloads.reannounce(DUNE))).toMatchObject({ ok: false, showing: true })
    expect(settled).toHaveBeenLastCalledWith({ ok: false, error: expect.any(TypeError) }, [DUNE])
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    await act(() => result.current.downloads.reannounce(DUNE))
    expect(settled).toHaveBeenLastCalledWith({ ok: true }, [DUNE])
    // Not another torrent that took its hash.
    await act(() => result.current.downloads.reannounce({ ...DUNE, added_on: 9 }))
    expect(settled).toHaveBeenCalledTimes(2)
  })
})
