import { vi } from 'vitest'

/**
 * For tests: stubs matchMedia so that `(pointer: coarse)` matches, a phone's touch screen, and
 * nothing else does (the phone layout). Undo with vi.unstubAllGlobals().
 */
export function stubTouchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query === '(pointer: coarse)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

interface Swipe {
  /** How far the finger moves, in pixels: up by default. */
  dx?: number
  dy?: number
  fingers?: number
}

/** A touch event with `fingers` touches at (x, y); jsdom's TouchEvent won't take plain objects. */
function touchEvent(type: string, x: number, y: number, fingers: number) {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true })
  const touches = Array.from({ length: fingers }, () => ({ clientX: x, clientY: y }))
  Object.defineProperty(event, 'touches', { value: touches })
  return event
}

/**
 * Whether a swipe on the element (by default the page's body) would move what's under it: a
 * touchmove nobody prevented.
 */
export function swipeMovesPage(element: Element = document.body, { dx = 0, dy = -50, fingers = 1 }: Swipe = {}): boolean {
  element.dispatchEvent(touchEvent('touchstart', 100, 300, fingers))
  return element.dispatchEvent(touchEvent('touchmove', 100 + dx, 300 + dy, fingers))
}
