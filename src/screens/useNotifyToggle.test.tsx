import { act, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { useNotifyToggle } from './useNotifyToggle'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  addTags: vi.fn(),
  removeTags: vi.fn(),
}))
const addTags = vi.mocked(api.addTags)
const removeTags = vi.mocked(api.removeTags)

const DUNE = torrent('dune', { added_on: 1, tags: 'tmdb:movie:693134' })
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
  addTags.mockResolvedValue()
  removeTags.mockResolvedValue()
})

describe('useNotifyToggle', () => {
  it('reads the switch from the torrent’s tag', () => {
    const { result } = renderHook(() => useNotifyToggle(), { wrapper: Providers })
    expect(result.current.value(DUNE)).toBe(false)
    expect(result.current.value({ ...DUNE, tags: 'kinopeer:notify, tmdb:movie:693134' })).toBe(true)
  })

  it('adds the tag to switch it on and takes it off to switch it off, without reading the torrent first', async () => {
    const { result } = renderHook(() => useNotifyToggle(), { wrapper: Providers })
    await act(() => result.current.set(DUNE, true))
    expect(addTags).toHaveBeenCalledWith(['dune'], ['kinopeer:notify'])
    await act(() => result.current.set(DUNE, false))
    expect(removeTags).toHaveBeenCalledWith(['dune'], ['kinopeer:notify'])
  })

  it('shows the value being sent and is busy until qBittorrent answers', async () => {
    let answer = () => {}
    addTags.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useNotifyToggle(), { wrapper: Providers })
    let settled!: Promise<unknown>
    act(() => {
      settled = result.current.set(DUNE, true)
    })
    expect(result.current.value(DUNE)).toBe(true)
    expect(result.current.busy('dune')).toBe(true)
    await act(async () => {
      answer()
      await settled
    })
    expect(result.current.busy('dune')).toBe(false)
  })

  it('says a failure in a toast, which trying again takes back', async () => {
    addTags.mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => useNotifyToggle(), { wrapper: Providers })
    await act(() => result.current.set(DUNE, true))
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
    expect(result.current.value(DUNE)).toBe(false)
    await act(() => result.current.set(DUNE, true))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})
