import { vi } from 'vitest'
import { DESKTOP_QUERY } from './breakpoints'

/**
 * For tests: stubs matchMedia so that `DESKTOP_QUERY` matches while `desktop` is true. jsdom has no
 * matchMedia, so useIsDesktop is false (the phone layout) unless a test calls this. Returns a
 * function that changes the answer later and tells the listeners. Vitest puts it back before each test.
 */
export function stubDesktop(desktop = true): (desktop: boolean) => void {
  let matches = desktop
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => {
    const isDesktopQuery = query === DESKTOP_QUERY
    return {
      media: query,
      get matches() {
        return isDesktopQuery && matches
      },
      addEventListener: (_type: string, listener: () => void) => isDesktopQuery && listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }
  })
  return (next) => {
    matches = next
    for (const listener of listeners) listener()
  }
}
