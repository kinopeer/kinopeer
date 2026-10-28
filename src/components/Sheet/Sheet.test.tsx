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
    const dialog = () => screen.getByRole('dialog')

    type PointerType = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel'

    // fireEvent can't set timeStamp, which the flick's speed is measured from.
    const pointer = (type: PointerType, target: Element, clientY: number, timeStamp = 0, init: { pointerId?: number; button?: number } = {}) => {
      const event = createEvent[type](target, { pointerId: 1, button: 0, clientY, ...init })
      Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      fireEvent(target, event)
    }

    /** Down, two moves and up over `ms`; the last half of the way sets the speed it's let go at. */
    const drag = (target: Element, from: number, to: number, ms: number, end: PointerType = 'pointerUp') => {
      pointer('pointerDown', target, from, 0)
      pointer('pointerMove', target, (from + to) / 2, ms / 2)
      pointer('pointerMove', target, to, ms)
      pointer(end, target, to, ms)
    }

    // 200px in a second ends at 0.2 px/ms, too slow for a flick, so only the distance can close it.
    const slowDrag = (target: Element, from: number, to: number) => drag(target, from, to, 1000)

    afterEach(() => {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'animate')
    })

    it('follows the finger while dragged', () => {
      renderSheet()
      pointer('pointerDown', handle(), 100)
      pointer('pointerMove', handle(), 160)
      expect(dialog().style.transform).toBe('translateY(60px)')
    })

    it('never goes above where it opened', () => {
      renderSheet()
      pointer('pointerDown', handle(), 300)
      pointer('pointerMove', handle(), 100)
      expect(dialog().style.transform).toBe('translateY(0px)')
    })

    it('closes once dragged far enough, however slowly', () => {
      const onClose = renderSheet()
      slowDrag(handle(), 100, 300)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('needs 30% of its height when that is further than the fixed distance', () => {
      const onClose = renderSheet()
      Object.defineProperty(dialog(), 'offsetHeight', { value: 1000 })
      slowDrag(handle(), 100, 380)
      expect(onClose).not.toHaveBeenCalled()
      slowDrag(handle(), 100, 420)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('closes on a quick flick, however short', () => {
      const onClose = renderSheet()
      drag(handle(), 100, 140, 40)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('goes back up when held still after a flick before letting go', () => {
      const onClose = renderSheet()
      pointer('pointerDown', handle(), 100, 0)
      pointer('pointerMove', handle(), 120, 20)
      pointer('pointerMove', handle(), 140, 40)
      pointer('pointerUp', handle(), 140, 1000)
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
    })

    it('ignores a second finger while one is dragging', () => {
      renderSheet()
      pointer('pointerDown', handle(), 100)
      pointer('pointerMove', handle(), 180, 100)
      pointer('pointerDown', handle(), 300, 150, { pointerId: 2 })
      pointer('pointerMove', handle(), 200, 200)
      expect(dialog().style.transform).toBe('translateY(100px)')
    })

    it('goes back up when let go after a short, slow drag', () => {
      const onClose = renderSheet()
      slowDrag(handle(), 100, 140)
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
      // The stylesheet's transition springs it back, not one left inline by the drag.
      expect(dialog().style.transition).toBe('')
    })

    it('goes back up when the browser cancels the drag, however far it went', () => {
      const onClose = renderSheet()
      drag(handle(), 100, 400, 100, 'pointerCancel')
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
    })

    it('follows only the pointer that started the drag', () => {
      const onClose = renderSheet()
      pointer('pointerDown', handle(), 100)
      pointer('pointerMove', handle(), 400, 100, { pointerId: 2 })
      pointer('pointerUp', handle(), 400, 100, { pointerId: 2 })
      expect(dialog().style.transform).toBe('')
      expect(onClose).not.toHaveBeenCalled()
    })

    it("doesn't drag with a mouse button other than the main one", () => {
      const onClose = renderSheet()
      pointer('pointerDown', handle(), 100, 0, { button: 2 })
      pointer('pointerMove', handle(), 400, 100)
      pointer('pointerUp', handle(), 400, 100)
      expect(dialog().style.transform).toBe('')
      expect(onClose).not.toHaveBeenCalled()
    })

    it.each([
      ['a button', () => <button type="button">Reset</button>, () => screen.getByRole('button', { name: 'Reset' })],
      ['a link', () => <a href="/help">Help</a>, () => screen.getByRole('link', { name: 'Help' })],
      ['a field', () => <input aria-label="Find" />, () => screen.getByRole('textbox', { name: 'Find' })],
    ])('leaves %s in its title row to its taps', (_, action, target) => {
      const onClose = renderSheet({ action: action() })
      slowDrag(target(), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
    })

    it("doesn't drag from its scrolling content", () => {
      const onClose = renderSheet()
      slowDrag(screen.getByText('Options'), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
    })

    it("doesn't drag on desktop, where it is a centered modal", () => {
      stubDesktop()
      const onClose = renderSheet()
      slowDrag(handle(), 100, 300)
      expect(onClose).not.toHaveBeenCalled()
      expect(dialog().style.transform).toBe('')
    })

    it('opens again where it belongs after being dragged closed', () => {
      const onClose = vi.fn()
      const sheet = (open: boolean) => (
        <Sheet open={open} onClose={onClose} title="Add release">
          <p>Options</p>
        </Sheet>
      )
      const { rerender } = render(sheet(true))
      slowDrag(handle(), 100, 300)
      expect(onClose).toHaveBeenCalledOnce()
      rerender(sheet(false))
      rerender(sheet(true))
      expect(dialog().style.transform).toBe('')
      expect(dialog().style.transition).toBe('')
    })

    describe('sliding off the screen, with motion', () => {
      const stubAnimate = () => {
        let finish = () => {}
        const animation = { finished: new Promise<void>((resolve) => (finish = resolve)), cancel: vi.fn() }
        const animate = vi.fn(() => animation)
        Object.defineProperty(HTMLDialogElement.prototype, 'animate', { value: animate, configurable: true })
        return { animate, animation, finish: () => finish() }
      }

      it('closes only once it has slid off, and ignores a new drag meanwhile', async () => {
        const { animate, finish } = stubAnimate()
        const onClose = renderSheet()
        slowDrag(handle(), 100, 300)
        expect(animate).toHaveBeenCalledWith(
          [{ transform: 'translateY(200px)' }, { transform: 'translateY(100%)' }],
          expect.objectContaining({ fill: 'forwards' }),
        )
        expect(onClose).not.toHaveBeenCalled()

        pointer('pointerDown', handle(), 100)
        pointer('pointerMove', handle(), 150)
        expect(dialog().style.transform).toBe('translateY(200px)')

        finish()
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      })

      it('slides off for as long as its own transition, in whatever unit the stylesheet gives it', () => {
        const { animate } = stubAnimate()
        const style = document.createElement('style')
        style.textContent = '.ks-sheet { transition-duration: 0.25s; }'
        document.head.append(style)
        try {
          renderSheet()
          slowDrag(handle(), 100, 300)
          expect(animate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 250 }))
        } finally {
          style.remove()
        }
      })

      it('closes once when closed another way while sliding off', async () => {
        const { finish } = stubAnimate()
        const onClose = vi.fn()
        const sheet = (open: boolean) => (
          <Sheet open={open} onClose={onClose} title="Add release">
            <p>Options</p>
          </Sheet>
        )
        const { rerender } = render(sheet(true))
        slowDrag(handle(), 100, 300)
        fireEvent(dialog(), new Event('cancel', { cancelable: true }))
        rerender(sheet(false))
        finish()
        await Promise.resolve()
        await Promise.resolve()
        expect(onClose).toHaveBeenCalledOnce()
      })

      it('drops the slide when it opens again', async () => {
        const { animation, finish } = stubAnimate()
        const onClose = vi.fn()
        const sheet = (open: boolean) => (
          <Sheet open={open} onClose={onClose} title="Add release">
            <p>Options</p>
          </Sheet>
        )
        const { rerender } = render(sheet(true))
        slowDrag(handle(), 100, 300)
        finish()
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
        rerender(sheet(false))
        rerender(sheet(true))
        expect(animation.cancel).toHaveBeenCalledOnce()
        expect(dialog().style.transform).toBe('')
      })
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
