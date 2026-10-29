import { fireEvent } from '@testing-library/react'
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

/** Whether a swipe on the page (by default its body) would move it: a touchmove nobody prevented. */
export function swipeMovesPage(element: Element = document.body): boolean {
  fireEvent.touchStart(element)
  return fireEvent.touchMove(element)
}
