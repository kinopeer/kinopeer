import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import * as serverMatches from '../torrents/serverMatches'
import { DeleteTorrentDialog } from './DeleteTorrentDialog'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  deleteTorrents: vi.fn(),
}))

vi.mock('../torrents/serverMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof serverMatches>()),
  forgetMatches: vi.fn(),
}))

const deleteTorrents = vi.mocked(api.deleteTorrents)
const forgetMatches = vi.mocked(serverMatches.forgetMatches)

const DUNE = { hash: 'dune', size: 20e9, progress: 0.42 }
const ALIEN = { hash: 'alien', size: 1e9, progress: 0.1 }

function renderDialog(torrents = [DUNE]) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(<DeleteTorrentDialog torrents={torrents} title="Dune: Part Two" onClose={onClose} onDeleted={onDeleted} />)
  const dialog = screen.getByRole('alertdialog')
  return { onClose, onDeleted, dialog, remove: () => userEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) }
}

beforeEach(() => {
  vi.resetAllMocks()
  deleteTorrents.mockResolvedValue()
  forgetMatches.mockResolvedValue()
})

describe('DeleteTorrentDialog', () => {
  it('names one torrent, or counts several', () => {
    const { dialog } = renderDialog()
    expect(dialog).toHaveAccessibleName('Delete torrent?')
    expect(dialog).toHaveTextContent('“Dune: Part Two” will be removed from qBittorrent.')

    render(<DeleteTorrentDialog torrents={[DUNE, ALIEN]} onClose={vi.fn()} onDeleted={vi.fn()} />)
    const many = screen.getByRole('alertdialog', { name: 'Delete torrents?' })
    expect(many).toHaveTextContent('2 torrents will be removed from qBittorrent.')
  })

  it('sums what the torrents have downloaded on the files checkbox', () => {
    renderDialog([DUNE, ALIEN])
    // 42% of 20 GB plus 10% of 1 GB.
    expect(screen.getByRole('checkbox', { name: /^Also delete files · 8\.50\sGB$/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the files unless asked, then forgets the torrents’ titles', async () => {
    const { onDeleted, remove } = renderDialog([DUNE, ALIEN])
    await remove()
    expect(deleteTorrents).toHaveBeenCalledWith(['dune', 'alien'], false)
    expect(forgetMatches).toHaveBeenCalledWith(['dune', 'alien'])
    expect(onDeleted).toHaveBeenCalledWith(false)
  })

  it('deletes the files too when the box is checked, after a warning', async () => {
    const { onDeleted, remove } = renderDialog()
    const files = screen.getByRole('checkbox', { name: /Also delete files/ })
    expect(screen.queryByText('Files are removed from disk permanently.')).not.toBeInTheDocument()
    await userEvent.click(files)
    expect(files).toHaveAttribute('aria-checked', 'true')
    expect(files).toHaveAccessibleDescription('Files are removed from disk permanently.')

    await remove()
    expect(deleteTorrents).toHaveBeenCalledWith(['dune'], true)
    expect(onDeleted).toHaveBeenCalledWith(true)
  })

  it('stays open with an error when qBittorrent doesn’t answer, and can try again', async () => {
    deleteTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { onDeleted, dialog, remove } = renderDialog()
    await remove()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Couldn’t reach qBittorrent. Try again.')
    expect(onDeleted).not.toHaveBeenCalled()
    // The torrent is still there, so its title match must stay too.
    expect(forgetMatches).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()

    await remove()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalledWith(false)
  })

  it('leaves the torrent alone on Cancel', async () => {
    const { onClose, onDeleted, dialog } = renderDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(deleteTorrents).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
