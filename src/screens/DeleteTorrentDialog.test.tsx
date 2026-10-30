import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeleteTorrentDialog, type DeleteTorrentDialogProps } from './DeleteTorrentDialog'
import { saying } from '../test/render'

const DUNE = { hash: 'dune', size: 20e9, progress: 0.42 }
const ALIEN = { hash: 'alien', size: 1e9, progress: 0.1 }

function renderDialog(props: Partial<DeleteTorrentDialogProps> = {}) {
  const handlers = { onClose: vi.fn(), onConfirm: vi.fn() }
  render(<DeleteTorrentDialog torrents={[DUNE]} title="Dune: Part Two" busy={false} failed={false} {...handlers} {...props} />)
  const dialog = screen.getByRole('alertdialog')
  return { ...handlers, dialog, confirm: () => userEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) }
}

describe('DeleteTorrentDialog', () => {
  it('names one torrent, or counts several', () => {
    const { dialog } = renderDialog()
    expect(dialog).toHaveAccessibleName('Delete torrent?')
    expect(dialog).toHaveTextContent('“Dune: Part Two” will be removed from qBittorrent.')

    render(<DeleteTorrentDialog torrents={[DUNE, ALIEN]} busy={false} failed={false} onConfirm={vi.fn()} onClose={vi.fn()} />)
    const many = screen.getByRole('alertdialog', { name: 'Delete torrents?' })
    expect(many).toHaveTextContent('2 torrents will be removed from qBittorrent.')
  })

  it('sums what the torrents have downloaded on the files checkbox', () => {
    renderDialog({ torrents: [DUNE, ALIEN] })
    // 42% of 20 GB plus 10% of 1 GB.
    expect(screen.getByRole('checkbox', { name: /^Also delete files · 8\.50\sGB$/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the files unless asked', async () => {
    const { onConfirm, confirm } = renderDialog()
    await confirm()
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('deletes the files too when the box is checked, after a warning', async () => {
    const { onConfirm, confirm } = renderDialog()
    const files = screen.getByRole('checkbox', { name: /Also delete files/ })
    expect(screen.queryByText('Files are removed from disk permanently.')).not.toBeInTheDocument()
    await userEvent.click(files)
    expect(files).toHaveAttribute('aria-checked', 'true')
    expect(files).toHaveAccessibleDescription('Files are removed from disk permanently.')

    await confirm()
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('is busy while a delete is on its way, and can still be closed', async () => {
    const { onClose, dialog } = renderDialog({ busy: true })
    const button = within(dialog).getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says a failure and can be confirmed again', () => {
    const { dialog } = renderDialog({ failed: true })
    expect(within(dialog).getByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('leaves the torrent alone on Cancel', async () => {
    const { onClose, onConfirm, dialog } = renderDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
