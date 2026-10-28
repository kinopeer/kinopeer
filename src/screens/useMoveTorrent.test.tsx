import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { useMoveTorrent } from './useMoveTorrent'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getSaveLocations: vi.fn(),
  setTorrentLocation: vi.fn(),
}))

const getSaveLocations = vi.mocked(api.getSaveLocations)
const setTorrentLocation = vi.mocked(api.setTorrentLocation)

const DUNE = { hash: 'dune', name: 'Dune.Part.Two.2024.2160p', save_path: '/downloads', added_on: 1 } as Torrent

function Harness({ torrents = { dune: DUNE }, offline = false, refresh }: {
  torrents?: Record<string, Torrent>
  offline?: boolean
  refresh: () => void
}) {
  const move = useMoveTorrent({ torrents, offline, refresh })
  return (
    <>
      <button type="button" onClick={() => move.open('dune')}>
        Open
      </button>
      {move.element}
    </>
  )
}

function renderMove(props: { torrents?: Record<string, Torrent>; offline?: boolean } = {}) {
  const refresh = vi.fn()
  const view = render(<Harness refresh={refresh} {...props} />)
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    return screen.getByRole('dialog', { name: 'Move files' })
  }
  const moveTo = async (sheet: HTMLElement, folder: string) => {
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, folder)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))
  }
  const rerender = (next: { torrents?: Record<string, Torrent>; offline?: boolean }) =>
    view.rerender(<Harness refresh={refresh} {...props} {...next} />)
  return { refresh, open, moveTo, rerender }
}

beforeEach(() => {
  vi.resetAllMocks()
  getSaveLocations.mockResolvedValue({
    defaultPath: '/downloads/',
    categories: [{ name: 'Movies', savePath: '/media/movies' }],
    categoryPaths: false,
    subcategories: false,
  })
  setTorrentLocation.mockResolvedValue()
})

describe('useMoveTorrent', () => {
  it('starts at the torrent’s folder and fills in a folder qBittorrent knows', async () => {
    const { open } = renderMove()
    const sheet = await open()
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    expect(field).toHaveValue('/downloads')
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeDisabled()
    const folders = await within(sheet).findByRole('group', { name: 'qBittorrent folders' })
    // The chip of the folder in the field is on, the trailing separator aside.
    expect(within(folders).getByRole('button', { name: '/downloads/' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(folders).getByRole('button', { name: '/media/movies' }))
    expect(field).toHaveValue('/media/movies')
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  it('takes the current folder with a trailing separator as no move', async () => {
    const { open } = renderMove()
    const sheet = await open()
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, '/downloads/')
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('takes a typed folder when qBittorrent knows none', async () => {
    getSaveLocations.mockResolvedValue({ defaultPath: '', categories: [], categoryPaths: false, subcategories: false })
    const { open, moveTo } = renderMove()
    const sheet = await open()
    await moveTo(sheet, '/media/new')
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
  })

  it('moves to the typed folder, trimmed, then closes, says where and refreshes', async () => {
    const { open, moveTo, refresh } = renderMove()
    await moveTo(await open(), ' /media/new ')
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
    expect(await screen.findByText('Moving files to /media/new')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('says why qBittorrent refused, and stays open', async () => {
    const { open, moveTo } = renderMove()
    const sheet = await open()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('no access', 403))
    await moveTo(sheet, '/root')
    expect(await within(sheet).findByText('qBittorrent has no access to that folder.')).toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('conflict', 409))
    await moveTo(sheet, '/media/nope')
    expect(await within(sheet).findByText('qBittorrent couldn’t create that folder.')).toBeInTheDocument()
    expect(within(sheet).queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await moveTo(sheet, '/media/later')
    expect(await within(sheet).findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  it('doesn’t blame the folder for a lost session, though qBittorrent answers 403 for both', async () => {
    setTorrentLocation.mockRejectedValueOnce(new api.UnauthorizedError())
    const { open, moveTo } = renderMove()
    const sheet = await open()
    await moveTo(sheet, '/media/later')
    expect(await within(sheet).findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
    expect(within(sheet).queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
  })

  it('reports a move that fails after the sheet was closed in a toast', async () => {
    let fail = (_error: unknown) => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const { open, moveTo } = renderMove()
    const sheet = await open()
    await moveTo(sheet, '/root')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
    fail(new api.QbittorrentError('no access', 403))
    expect(await screen.findByRole('status')).toHaveTextContent('qBittorrent has no access to that folder.')
  })

  it('closes when the torrent is gone, and stays closed when it’s added again', async () => {
    const { open, rerender } = renderMove()
    await open()
    rerender({ torrents: {} })
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
    const readded = { ...DUNE, added_on: 2 }
    rerender({ torrents: { dune: readded } })
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
    expect(await open()).toBeInTheDocument()
  })

  it('reports a failed move whose torrent went away in a toast', async () => {
    let fail = (_error: unknown) => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const { open, moveTo, rerender } = renderMove()
    await moveTo(await open(), '/media/new')
    rerender({ torrents: {} })
    fail(new api.QbittorrentError('conflict', 409))
    expect(await screen.findByRole('status')).toHaveTextContent('qBittorrent couldn’t create that folder.')
  })

  it('can’t move while qBittorrent is unreachable', async () => {
    const { open, rerender } = renderMove()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: '/media/movies' }))
    rerender({ offline: true })
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeDisabled()
  })
})
