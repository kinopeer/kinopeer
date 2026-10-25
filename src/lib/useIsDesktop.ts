import { useCallback, useSyncExternalStore } from 'react'
import { DESKTOP_QUERY } from './breakpoints'

/** Whether the media query matches, kept up to date. False where matchMedia is missing (jsdom). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false)
}

/**
 * Whether the desktop layout applies (`DESKTOP_QUERY`). For behavior that differs on desktop, such
 * as what renders; differences only in looks belong in CSS media queries.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY)
}
