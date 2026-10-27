import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubDesktop } from '../../lib/stubDesktop'
import { Sheet } from './Sheet'

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSheet = (props: Partial<Parameters<typeof Sheet>[0]> = {}) => {
  const onClose = vi.fn()
  render(
    <Sheet open onClose={onClose} title="Add release" subtitle="Dune" footer={<button type="button">Download</button>} {...props}>
      <p>Options</p>
    </Sheet>,
  )
  return onClose
}

describe('Sheet', () => {
  it('is a dialog named by its title, with the content and the footer', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog', { name: 'Add release' })
    expect(dialog).toHaveTextContent('Dune')
    expect(dialog).toHaveTextContent('Options')
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })

  it('renders nothing inside while closed', () => {
    renderSheet({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Options')).not.toBeInTheDocument()
  })

  it('closes on Escape and on a click on the backdrop, not on its content', async () => {
    const onClose = renderSheet()
    await userEvent.click(screen.getByText('Options'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('stays open when a dialog inside it is cancelled', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Add release">
        <dialog open aria-label="Confirm" />
      </Sheet>,
    )
    fireEvent(screen.getByRole('dialog', { name: 'Confirm' }), new Event('cancel', { cancelable: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes the large size for long lists', () => {
    renderSheet({ size: 'lg' })
    expect(screen.getByRole('dialog')).toHaveClass('ks-sheet', 'ks-sheet-lg')
  })

  it('is medium by default', () => {
    renderSheet()
    expect(screen.getByRole('dialog')).not.toHaveClass('ks-sheet-lg')
  })

  it('stays the same dialog on desktop, where only its styles make it a centered modal', () => {
    stubDesktop()
    const onClose = renderSheet({ leading: <button type="button">Back</button>, action: <button type="button">Reset</button> })
    expect(screen.getByRole('dialog', { name: 'Add release' })).toHaveClass('ks-sheet')
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
