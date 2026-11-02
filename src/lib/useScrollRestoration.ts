import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { pageScrollY } from './holdPage'

/** The window's scroll position per history entry (`location.key`), in sessionStorage so it outlives a reload. */
const STORAGE_PREFIX = 'kinoseed.scroll:'

function savedPosition(key: string): number | undefined {
  try {
    const value = sessionStorage.getItem(STORAGE_PREFIX + key)
    return value === null ? undefined : Number(value)
  } catch {
    return undefined
  }
}

function savePosition(key: string, y: number): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(y))
  } catch {
    // Storage is full or blocked: the screen comes back at the top, as before.
  }
}

/**
 * Brings a screen back to where it was scrolled when the user returns to it through history (Back
 * or Forward). The browser tries this itself, but the screen's content loads after it renders, so
 * the page is still short when the browser scrolls and the position gets lost. `ready` says the
 * content is on the page: the position is restored once it turns true, then left alone. The
 * position is saved when the screen goes away; a fresh navigation starts at the top as before.
 */
export function useScrollRestoration(ready: boolean): void {
  const { key } = useLocation()
  const navigationType = useNavigationType()
  // The entry whose restore is done (or wasn't needed). Until then its position is left as saved,
  // so the browser's own, clamped attempt doesn't overwrite it.
  const settledKey = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (settledKey.current === key) return
    const saved = navigationType === 'POP' ? savedPosition(key) : undefined
    if (saved === undefined) {
      settledKey.current = key
      return
    }
    if (!ready) return
    window.scrollTo(0, saved)
    settledKey.current = key
  }, [key, navigationType, ready])

  useLayoutEffect(
    () => () => {
      // Runs before the next screen's content replaces this one, so the position is still intact.
      if (settledKey.current === key) savePosition(key, pageScrollY())
    },
    [key],
  )
}
