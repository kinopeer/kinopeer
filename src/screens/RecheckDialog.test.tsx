import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecheckDialog, type RecheckDialogProps } from './RecheckDialog'
import { saying } from '../test/render'

function renderDialog(props: Partial<RecheckDialogProps> = {}) {
  const handlers = { onClose: vi.fn(), onConfirm: vi.fn() }
  render(<RecheckDialog title="Dune: Part Two" busy={false} failed={false} {...handlers} {...props} />)
  return handlers
}

describe('RecheckDialog', () => {
  it('says what a recheck does and starts it on confirm', async () => {
    const handlers = renderDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Recheck the files?' })
    expect(dialog).toHaveTextContent('qBittorrent will read the downloaded data of “Dune: Part Two” again.')
    await userEvent.click(screen.getByRole('button', { name: 'Force recheck' }))
    expect(handlers.onConfirm).toHaveBeenCalled()
  })

  it('is busy while the recheck is on its way, and can still be closed', async () => {
    const handlers = renderDialog({ busy: true })
    const confirm = screen.getByRole('button', { name: 'Force recheck' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it('says a failure and can be confirmed again', () => {
    renderDialog({ failed: true })
    expect(screen.getByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Force recheck' })).toBeEnabled()
  })

  it('cancels without confirming', async () => {
    const handlers = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handlers.onClose).toHaveBeenCalled()
    expect(handlers.onConfirm).not.toHaveBeenCalled()
  })
})
