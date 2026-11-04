import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFrames } from '../test/frames'
import { useSkipOffscreen } from './useSkipOffscreen'

let nextFrame: () => void
let onResize: () => void
let observed: Set<Element>
let list: HTMLElement
const disconnect = vi.fn()

/** The list's size changed: the observer hears of it only if it watches the list. */
const resize = () =>
  act(() => {
    if (observed.has(list)) onResize()
  })

/** jsdom lays nothing out, so the list's width is whatever the test says. */
function listWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 0 } as DOMRect)
}

beforeEach(() => {
  ;({ nextFrame } = stubFrames())
  onResize = () => {}
  observed = new Set()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback
      }
      observe = (element: Element) => observed.add(element)
      disconnect = disconnect
    },
  )
  listWidth(390)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Props = { layout?: string; ids: string[] }

/** The hook on a list element, with rows `a` and `b` in the list's layout by default. */
function renderList(props: Props = { layout: 'list', ids: ['a', 'b'] }) {
  const hook = renderHook(({ layout, ids }: Props) => useSkipOffscreen(layout, ids), { initialProps: props })
  list = document.createElement('ul')
  act(() => hook.result.current.ref(list))
  return hook
}

/** Two frames: by then the rows shown have been laid out in full once. */
const laidOut = () => {
  nextFrame()
  nextFrame()
}

describe('useSkipOffscreen', () => {
  it('lets the rows be skipped once they’ve been laid out, and not while there are none', () => {
    const { result, rerender } = renderList({ layout: undefined, ids: [] })
    laidOut()
    expect(result.current.skip).toBe(false)

    rerender({ layout: 'list', ids: ['a', 'b'] })
    expect(result.current.skip).toBe(false)
    laidOut()
    expect(result.current.skip).toBe(true)
  })

  it('lays the rows out again in another layout', () => {
    const { result, rerender } = renderList()
    laidOut()

    rerender({ layout: 'grid', ids: ['a', 'b'] })
    expect(result.current.skip).toBe(false)
    laidOut()
    expect(result.current.skip).toBe(true)
  })

  // A skipped row keeps the height it had at the old width: a phone turned, a window resized.
  it('lays the rows out again when the list’s width changes, not its height', () => {
    const { result } = renderList()
    laidOut()

    resize()
    expect(result.current.skip).toBe(true)

    listWidth(844)
    resize()
    expect(result.current.skip).toBe(false)
    laidOut()
    expect(result.current.skip).toBe(true)
  })

  // A row shown again, as when a filter is undone, is a new element with no height of its own yet.
  it('lays the rows out again when the rows shown change, not when they only move', () => {
    const { result, rerender } = renderList()
    laidOut()

    rerender({ layout: 'list', ids: ['b', 'a'] })
    expect(result.current.skip).toBe(true)

    rerender({ layout: 'list', ids: ['b', 'a', 'c'] })
    expect(result.current.skip).toBe(false)
    laidOut()
    expect(result.current.skip).toBe(true)
  })

  it('stops watching the list’s width once it’s gone', () => {
    const { unmount } = renderList()
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
