import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { isTabReturn, saveTabPlace, tabPlace } from './tabPlaces'

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
 * Brings a tab's screen (`tab`, the tab's path) back to where it was scrolled when the user returns
 * to it through history (Back or Forward), and to where the tab was left when the tab's link opens
 * it (the link sends `TAB_RETURN`). The browser tries the first itself, but the screen's content
 * loads after it renders, so the page is still short when the browser scrolls and the position gets
 * lost. `ready` says the content is on the page: the position is restored once it turns true, then
 * left alone. The position is saved when the screen goes away or its entry changes, and the tab's
 * place with it. Another navigation is `useNewScreenAtTop`'s.
 */
export function useScrollRestoration(ready: boolean, tab: string): void {
  const { key, search, state } = useLocation()
  // The entry whose restore is done (or wasn't needed). Until then its position is left as saved,
  // so the browser's own, clamped attempt doesn't overwrite it.
  const settledKey = useRef<string | null>(null)
  // A tab's link brings the screen back only when it opens it: on a screen already shown (Downloads
  // under the desktop drawer) it stays where it is.
  const mountedKey = useRef(key)

  useLayoutEffect(() => {
    if (settledKey.current === key) return
    // Only an entry shown before has a position saved, so this is Back or Forward. Not
    // `useNavigationType()`: under App's `<Routes location>` every navigation reads as POP.
    const tabReturn = key === mountedKey.current && isTabReturn(state)
    const saved = savedPosition(key) ?? (tabReturn ? (tabPlace(tab)?.y ?? 0) : undefined)
    if (saved === undefined) {
      settledKey.current = key
      return
    }
    if (!ready && saved > 0) return
    window.scrollTo(0, saved)
    settledKey.current = key
  }, [key, ready, state, tab])

  useLayoutEffect(
    () => () => {
      // Runs before the next screen's content replaces this one, so the position is still intact.
      if (settledKey.current !== key) return
      savePosition(key, window.scrollY)
      saveTabPlace(tab, { search, y: window.scrollY })
    },
    [key, search, tab],
  )
}

/**
 * Opens a new screen at the top on a forward navigation. The window is the only scroller, so a
 * screen would otherwise open where the last one was scrolled to. `screen` names what's shown, so a
 * drawer opening over a page or a query typed into the URL leaves it alone. Back and Forward are
 * `useScrollRestoration`'s and the browser's, and a tab's link the screen's own.
 */
export function useNewScreenAtTop(screen: string): void {
  const navigationType = useNavigationType()
  const { state } = useLocation()
  const shown = useRef(screen)

  useLayoutEffect(() => {
    if (shown.current === screen) return
    shown.current = screen
    if (navigationType !== 'POP' && !isTabReturn(state)) window.scrollTo(0, 0)
  }, [screen, navigationType, state])
}
