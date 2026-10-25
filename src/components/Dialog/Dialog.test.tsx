import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubDesktop } from '../../lib/stubDesktop'
import { Dialog } from './Dialog'

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderDialog = (open = true) => {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  render(
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete torrent?"
      icon="trash"
      tone="danger"
      actions={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Delete
          </button>
        </>
      }
    >
      <p>Dune will be removed.</p>
    </Dialog>,
  )
  return { onClose, onConfirm }
}

describe('Dialog', () => {
  it('is an alert dialog named by its title, with the content and the actions', async () => {
    const { onConfirm } = renderDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    expect(dialog).toHaveClass('ks-dialog', 'ks-dialog-danger')
    expect(dialog).toHaveTextContent('Dune will be removed.')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('renders nothing inside while closed', () => {
    renderDialog(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and on a click on the backdrop, not on its content', async () => {
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByText('Dune will be removed.'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('stays the same alert dialog on desktop, where only its styles change', () => {
    stubDesktop()
    renderDialog()
    expect(screen.getByRole('alertdialog', { name: 'Delete torrent?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
