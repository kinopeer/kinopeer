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

interface Move {
  /** Where the finger is, from where it went down, in pixels. */
  dx: number
  dy: number
}

/**
 * A touch event with `fingers` touches at (x, y), the first on `first` (the event's own target by
 * default); jsdom's TouchEvent won't take plain objects.
 */
function touchEvent(type: string, x: number, y: number, fingers: number, first?: Element) {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true })
  const touches = Array.from({ length: fingers }, (_, i) => ({ clientX: x, clientY: y, target: i === 0 ? first : undefined }))
  Object.defineProperty(event, 'touches', { value: touches })
  return event
}

/**
 * A finger going down on the element (unless `down` is false: it was down already) and moving
 * through `moves`; with several fingers, the first one can be on another element, `first`.
 * Returns, for each move, whether it would move what's under it: nobody prevented it.
 */
export function swipe(element: Element, moves: Move[], { fingers = 1, down = true, first }: { fingers?: number; down?: boolean; first?: Element } = {}): boolean[] {
  if (down) element.dispatchEvent(touchEvent('touchstart', 100, 300, fingers, first))
  return moves.map(({ dx, dy }) => element.dispatchEvent(touchEvent('touchmove', 100 + dx, 300 + dy, fingers)))
}

/**
 * Whether a swipe on the element (by default the page's body) would move what's under it: a
 * touchmove nobody prevented.
 */
export function swipeMovesPage(element: Element = document.body, { dx = 0, dy = -50, fingers = 1 }: Swipe = {}): boolean {
  return swipe(element, [{ dx, dy }], { fingers })[0]!
}
