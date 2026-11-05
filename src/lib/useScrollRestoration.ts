import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { isTabReturn, saveTabPlace, tabPlace } from './tabPlaces'

/** The window's scroll position per history entry (`location.key`), in sessionStorage so it outlives a reload. */
const STORAGE_PREFIX = 'kinopeer.scroll:'

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

/** React Router's key for a document's first history entry, which has no history state yet. */
const FIRST_ENTRY = 'default'

let firstLoadChecked = false

/**
 * Every document's first entry has the same key, so a document opened afresh in the tab (a typed
 * address, a link from elsewhere) would find the position an earlier one saved for its own first
 * entry, likely another screen's. Such a load forgets it, once per document; a reload and Back into
 * the document keep it, since it's theirs.
 */
function forgetEarlierFirstEntry(): void {
  if (firstLoadChecked) return
  firstLoadChecked = true
  const [load] = performance.getEntriesByType?.('navigation') ?? []
  if ((load as PerformanceNavigationTiming | undefined)?.type !== 'navigate') return
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + FIRST_ENTRY)
  } catch {
    // Storage is blocked: nothing was saved under it either.
  }
}

/**
 * Brings a tab's screen (`tab`, the tab's path) back to where it was scrolled when the user returns
 * to it through history (Back or Forward), and to where the tab was left when the tab's link opens
 * it (the link sends `TAB_RETURN`). The browser tries the first itself, but the screen's content
 * loads after it renders, so the page is still short when the browser scrolls and the position gets
 * lost. `ready` says the content is on the page: the position is restored once it turns true, then
 * left alone. The position is saved when the screen goes away, its entry changes or the page is
 * hidden, and the tab's place when the screen goes away. Another navigation is `useNewScreenAtTop`'s.
 */
export function useScrollRestoration(ready: boolean, tab: string): void {
  const { key, search, state } = useLocation()
  // The entry whose restore is done (or wasn't needed). Until then its position is left as saved,
  // so the browser's own, clamped attempt doesn't overwrite it.
  const settledKey = useRef<string | null>(null)
  // A tab's link brings the screen back only when it opens it: on a screen already shown (Downloads
  // under the desktop drawer) it stays where it is.
  const mountedKey = useRef(key)
  // The entry and query shown last, for the tab's place when the screen goes away.
  const shown = useRef({ key, search })

  useLayoutEffect(() => {
    forgetEarlierFirstEntry()
    shown.current = { key, search }
    if (settledKey.current === key) return
    // Only an entry shown before has a position saved, so this is Back, Forward or a reload. Not
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
  }, [key, search, ready, state, tab])

  useLayoutEffect(
    () => () => {
      // Runs before the next screen's content replaces this one, so the position is still intact.
      if (settledKey.current === key) savePosition(key, window.scrollY)
    },
    [key],
  )

  // The tab's place only when the screen goes away: Search replaces its entry on every keystroke,
  // and only the last one matters.
  useLayoutEffect(
    () => () => {
      if (settledKey.current === shown.current.key) saveTabPlace(tab, { search: shown.current.search, y: window.scrollY })
    },
    [tab],
  )

  // A reload or the page closing runs no cleanup, so the entry's position is saved as the page is
  // hidden or goes away. Otherwise a reload of an entry the tab's link opened would go back to where
  // the tab was left before it, rather than where the user was.
  useEffect(() => {
    // Shown again, the page is where it was, so saving then changes nothing.
    const save = () => {
      if (settledKey.current === key) savePosition(key, window.scrollY)
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
    }
  }, [key])
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

