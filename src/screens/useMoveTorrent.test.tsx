import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { MoveOutcomeProvider } from './MoveOutcomeToast'
import { useMoveTorrent } from './useMoveTorrent'
import { saying } from '../test/render'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getSaveLocations: vi.fn(),
  setTorrentLocation: vi.fn(),
}))

const getSaveLocations = vi.mocked(api.getSaveLocations)
const setTorrentLocation = vi.mocked(api.setTorrentLocation)

const DUNE = { hash: 'dune', name: 'Dune.Part.Two.2024.2160p', save_path: '/downloads', added_on: 1 } as Torrent
const ANDOR = { hash: 'andor', name: 'Andor.S02.1080p', save_path: '/downloads', added_on: 1 } as Torrent

function Harness({ torrents = { dune: DUNE }, offline = false, refresh }: {
  torrents?: Record<string, Torrent>
  offline?: boolean
  refresh: () => void
}) {
  const move = useMoveTorrent({ torrents, offline, refresh })
  return (
    <section aria-label="Screen">
      {Object.keys(torrents).map((hash) => (
        <button key={hash} type="button" onClick={() => move.open(hash)}>
          Open {hash}
        </button>
      ))}
      {move.element}
    </section>
  )
}

function renderMove(props: { torrents?: Record<string, Torrent>; offline?: boolean } = {}) {
  const refresh = vi.fn()
  const view = render(<Harness refresh={refresh} {...props} />)
  const open = async (hash = 'dune') => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${hash}` }))
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
    // Still being sent, so the sheet stays open, with qBittorrent's answer about its folders in.
    setTorrentLocation.mockReturnValue(new Promise(() => {}))
    const sheet = await open()
    await moveTo(sheet, '/media/new')
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
    expect(within(sheet).queryByRole('group', { name: 'qBittorrent folders' })).not.toBeInTheDocument()
  })

  it('takes only a full path, since qBittorrent would check a relative one in another folder', async () => {
    const { open } = renderMove()
    const sheet = await open()
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    const move = within(sheet).getByRole('button', { name: 'Move' })
    for (const folder of ['Movies', '~/Movies']) {
      await userEvent.clear(field)
      await userEvent.type(field, folder)
      expect(field).toHaveAccessibleDescription('Type the full path, starting with / (or a drive such as D:\\ on Windows).')
      expect(move).toBeDisabled()
    }
    await userEvent.clear(field)
    await userEvent.type(field, '/media/movies')
    expect(field).not.toHaveAccessibleDescription()
    expect(move).toBeEnabled()
  })

  it('moves to the typed folder, trimmed, then closes, says where and refreshes', async () => {
    const { open, moveTo, refresh } = renderMove()
    await moveTo(await open(), ' /media/new ')
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
    expect(await screen.findByRole('status', { name: saying('Moving files to /media/new') })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('says why qBittorrent refused, and stays open', async () => {
    const { open, moveTo } = renderMove()
    const sheet = await open()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('no access', 403))
    await moveTo(sheet, '/root')
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent has no access to that folder.') })).toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('conflict', 409))
    await moveTo(sheet, '/media/nope')
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
    expect(within(sheet).queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await moveTo(sheet, '/media/later')
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  it('clears a refusal when the move is tried again', async () => {
    const { open, moveTo } = renderMove()
    const sheet = await open()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('no access', 403))
    await moveTo(sheet, '/root')
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent has no access to that folder.') })).toBeInTheDocument()
    setTorrentLocation.mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))
    expect(within(sheet).queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
  })

  it('opens again without an earlier refusal', async () => {
    const { open, moveTo } = renderMove()
    const sheet = await open()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('no access', 403))
    await moveTo(sheet, '/root')
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent has no access to that folder.') })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(within(await open()).queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
  })

  it('doesn’t blame the folder for a lost session, though qBittorrent answers 403 for both', async () => {
    setTorrentLocation.mockRejectedValueOnce(new api.UnauthorizedError())
    const { open, moveTo } = renderMove()
    const sheet = await open()
    await moveTo(sheet, '/media/later')
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
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
    expect(await screen.findByRole('status', { name: saying('qBittorrent has no access to that folder.') })).toBeInTheDocument()
  })

  it('reports a failed move whose torrent went away in a toast', async () => {
    let fail = (_error: unknown) => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const { open, moveTo, rerender } = renderMove()
    await moveTo(await open(), '/media/new')
    rerender({ torrents: {} })
    fail(new api.QbittorrentError('conflict', 409))
    expect(await screen.findByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
  })

  it('can’t move while qBittorrent is unreachable', async () => {
    const { open, rerender } = renderMove()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: '/media/movies' }))
    rerender({ offline: true })
    expect(within(sheet).getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('keeps a torrent’s move busy when another torrent’s earlier move settles', async () => {
    const settle: (() => void)[] = []
    setTorrentLocation.mockImplementation(() => new Promise<void>((resolve) => settle.push(resolve)))
    const { open, moveTo } = renderMove({ torrents: { dune: DUNE, andor: ANDOR } })
    const dune = await open('dune')
    await moveTo(dune, '/media/movies')
    await userEvent.click(within(dune).getByRole('button', { name: 'Cancel' }))
    const andor = await open('andor')
    await moveTo(andor, '/media/tv')
    settle[0]()
    expect(await screen.findByRole('status', { name: saying('Moving files to /media/movies') })).toBeInTheDocument()
    // A second tap would send andor's move again.
    expect(within(andor).getByRole('button', { name: 'Move' })).toBeDisabled()
  })
  it('moves once, however often Move is pressed while the move is being sent', async () => {
    setTorrentLocation.mockReturnValue(new Promise(() => {}))
    const { open, moveTo } = renderMove()
    const sheet = await open()
    await moveTo(sheet, '/media/movies')
    await userEvent.click(within(sheet).getByRole('button', { name: /Move/ }))
    // A second request could land after the first and leave the files in either folder.
    expect(setTorrentLocation).toHaveBeenCalledTimes(1)
  })

  it('shows a move from a closed sheet in the one opened again for the same torrent, and closes that once sent', async () => {
    let moved = () => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((resolve) => (moved = resolve)))
    const { open, moveTo } = renderMove()
    const first = await open()
    await moveTo(first, '/media/movies')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    const again = await open()
    // Another folder typed: Move is off only because the first move is still being sent.
    await userEvent.type(within(again).getByRole('textbox', { name: 'Folder' }), '/elsewhere')
    expect(within(again).getByRole('button', { name: /Move/ })).toBeDisabled()
    moved()
    expect(await screen.findByRole('status')).toHaveTextContent('Moving files to /media/movies')
    expect(screen.queryByRole('dialog', { name: 'Move files' })).not.toBeInTheDocument()
  })

  it('says in the sheet opened again for the same torrent that the move from the closed one failed', async () => {
    let fail = (_error: unknown) => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const { open, moveTo } = renderMove()
    const first = await open()
    await moveTo(first, '/root')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    const again = await open()
    fail(new api.QbittorrentError('no access', 403))
    expect(await within(again).findByRole('alert', { name: saying('qBittorrent has no access to that folder.') })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a torrent’s move busy after another torrent’s move started, so it isn’t sent twice', async () => {
    setTorrentLocation.mockImplementation(() => new Promise(() => {}))
    const { open, moveTo } = renderMove({ torrents: { dune: DUNE, andor: ANDOR } })
    const dune = await open('dune')
    await moveTo(dune, '/media/movies')
    await userEvent.click(within(dune).getByRole('button', { name: 'Cancel' }))
    const andor = await open('andor')
    await moveTo(andor, '/media/tv')
    await userEvent.click(within(andor).getByRole('button', { name: 'Cancel' }))
    const again = await open('dune')
    // Another folder typed: Move is off only because dune's move is still being sent.
    await userEvent.type(within(again).getByRole('textbox', { name: 'Folder' }), '/elsewhere')
    expect(within(again).getByRole('button', { name: /Move/ })).toBeDisabled()
  })
})

describe('useMoveTorrent under App’s MoveOutcomeProvider', () => {
  function renderInApp() {
    const view = render(
      <MoveOutcomeProvider>
        <Harness refresh={vi.fn()} />
      </MoveOutcomeProvider>,
    )
    return { leave: () => view.rerender(<MoveOutcomeProvider>{null}</MoveOutcomeProvider>) }
  }
  const moveTo = async (folder: string) => {
    await userEvent.click(screen.getByRole('button', { name: 'Open dune' }))
    const sheet = screen.getByRole('dialog', { name: 'Move files' })
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, folder)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))
  }

  it('says how the move went inside the screen while it’s there, since a drawer is a modal dialog', async () => {
    renderInApp()
    await moveTo('/media/new')
    const toast = await screen.findByRole('status', { name: saying('Moving files to /media/new') })
    expect(within(screen.getByRole('region', { name: 'Screen' })).getByRole('status')).toBe(toast)
  })

  it('says how the move went once the screen that started it is gone', async () => {
    let fail = (_error: unknown) => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const { leave } = renderInApp()
    // Left with the sheet still open, as Back does on a phone.
    await moveTo('/media/new')
    leave()
    fail(new api.QbittorrentError('conflict', 409))
    expect(await screen.findByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
  })
})
