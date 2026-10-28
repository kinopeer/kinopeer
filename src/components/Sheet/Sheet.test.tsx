import { createEvent, fireEvent, render, screen } from '@testing-library/react'
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

  describe('dragged down by its top on a phone', () => {
    // The grabber and the title row are the handle; the grabber itself is aria-hidden.
    const handle = () => screen.getByRole('heading', { name: 'Add release' })

    // fireEvent can't set timeStamp, which the flick's speed is measured from.
    const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', target: Element, clientY: number, timeStamp: number) => {
      const event = createEvent[type](target, { pointerId: 1, clientY, button: 0 })
      Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      fireEvent(target, event)
    }

    const drag = (target: Element, from: number, to: number, ms = 300) => {
      pointer('pointerDown', target, from, 0)
      pointer('pointerMove', target, (from + to) / 2, ms / 2)
      pointer('pointerMove', target, to, ms)
      pointer('pointerUp', target, to, ms)
    }

    it('follows the finger while dragged', () => {
      renderSheet()
      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 100, button: 0 })
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 160 })
      expect(screen.getByRole('dialog').style.transform).toBe('translateY(60px)')
    })

    it('closes once dragged far enough', () => {
      const onClose = renderSheet()
      drag(handle(), 100, 300)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('closes on a quick flick, however short', () => {
      const onClose = renderSheet()
      drag(handle(), 100, 140, 40)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('goes back up when let go after a short, slow drag', () => {
      const onClose = renderSheet()
      drag(handle(), 100, 140, 400)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog').style.transform).toBe('')
    })

    it('never goes above where it opened', () => {
      renderSheet()
      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 300, button: 0 })
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 100 })
      expect(screen.getByRole('dialog').style.transform).toBe('translateY(0px)')
    })

    it('leaves the buttons in its title row to their taps', () => {
      const onClose = renderSheet({ action: <button type="button">Reset</button> })
      drag(screen.getByRole('button', { name: 'Reset' }), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog').style.transform).toBe('')
    })

    it("doesn't drag from its scrolling content", () => {
      const onClose = renderSheet()
      drag(screen.getByText('Options'), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
    })

    it("doesn't drag on desktop, where it is a centered modal", () => {
      stubDesktop()
      const onClose = renderSheet()
      drag(handle(), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog').style.transform).toBe('')
    })
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
