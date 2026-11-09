import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Popover, type PopoverProps } from './Popover'

type Options = Partial<Pick<PopoverProps, 'align' | 'offset' | 'follow'>>

// The wrapper takes the focus like the modal dialog a popover can sit in: a click on something that
// can't take it focuses the nearest ancestor that can.
function Harness(options: Options) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div tabIndex={-1}>
      <button type="button" onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        Open
      </button>
      {anchor && (
        <Popover {...options} anchor={anchor} role="group" aria-label="Filters" onClose={() => setAnchor(null)}>
          <button type="button">Inside</button>
          <button type="button" disabled>
            Off
          </button>
        </Popover>
      )}
      <button type="button">Elsewhere</button>
    </div>
  )
}

/** Puts the anchor at a box and gives the popover a size, since jsdom lays nothing out. */
function layout(box: { top: number; left: number; width: number; height: number }) {
  const rect = { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }
  vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
}

async function open(options: Options = {}) {
  render(<Harness {...options} />)
  const anchor = screen.getByRole('button', { name: 'Open' })
  await userEvent.click(anchor)
  return { anchor, popover: screen.getByRole('group', { name: 'Filters' }) }
}

describe('Popover', () => {
  it('sits under its anchor, lined up with its right edge', async () => {
    layout({ top: 100, left: 300, width: 80, height: 38 })
    const { popover } = await open()
    expect(popover).toHaveClass('ks-pop')
    expect(popover.style.top).toBe('144px')
    expect(popover.style.left).toBe('180px')
  })

  it('lines up with the left edge and takes an offset', async () => {
    layout({ top: 100, left: 300, width: 80, height: 38 })
    const { popover } = await open({ align: 'start', offset: 8 })
    expect(popover.style.top).toBe('146px')
    expect(popover.style.left).toBe('300px')
  })

  it('goes above the anchor when there is no room under it, and stays on screen', async () => {
    layout({ top: window.innerHeight - 50, left: 10, width: 80, height: 38 })
    const { popover } = await open()
    expect(popover.style.top).toBe(`${window.innerHeight - 50 - 6 - 100}px`)
    expect(popover.style.left).toBe('8px')
  })

  it('closes on Escape with focus back on the anchor, and keeps Escape from a dialog around it', async () => {
    const { anchor } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }))
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    act(() => {
      screen.getByRole('button', { name: 'Inside' }).dispatchEvent(escape)
    })
    document.removeEventListener('keydown', outer)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(anchor).toHaveFocus()
    expect(escape.defaultPrevented).toBe(true)
    expect(outer).not.toHaveBeenCalled()
  })

  it('closes on Escape while the anchor has the focus', async () => {
    const { anchor } = await open()
    expect(anchor).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('closes on a click outside, and the anchor toggles it', async () => {
    const { anchor } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }))
    expect(screen.getByRole('group')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()

    await userEvent.click(anchor)
    await userEvent.click(anchor)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('stays open with the focus in it after a click on something in it that can’t take the focus', async () => {
    const { popover } = await open()
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }))
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(popover).toBeInTheDocument()
    expect(popover).toHaveFocus()
  })

  it('keeps the tab order and closes once the focus leaves it', async () => {
    await open()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('group')).toBeInTheDocument()
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('closes on a scroll outside it or a resize', async () => {
    await open()
    fireEvent.scroll(screen.getByRole('group'))
    expect(screen.getByRole('group')).toBeInTheDocument()
    fireEvent.scroll(document)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent(window, new Event('resize'))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('follows the anchor on a scroll or a resize when asked to', async () => {
    layout({ top: 100, left: 300, width: 80, height: 38 })
    const { popover } = await open({ follow: true })
    layout({ top: 20, left: 300, width: 80, height: 38 })
    fireEvent.scroll(document)
    expect(popover).toBeInTheDocument()
    expect(popover.style.top).toBe('64px')
    layout({ top: 20, left: 400, width: 80, height: 38 })
    fireEvent(window, new Event('resize'))
    expect(popover.style.left).toBe('280px')
  })

  it('follows the anchor when it moves as the page renders', async () => {
    layout({ top: 100, left: 300, width: 80, height: 38 })
    const { rerender } = render(<Harness follow />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const popover = screen.getByRole('group', { name: 'Filters' })
    expect(popover.style.top).toBe('144px')
    layout({ top: 160, left: 300, width: 80, height: 38 })
    rerender(<Harness follow />)
    expect(popover.style.top).toBe('204px')
  })
})
