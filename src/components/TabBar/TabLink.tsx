import type { MouseEvent, ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { TAB_RETURN, useTabSearch } from '../../lib/tabPlaces'
import { isTabOn } from './isTabOn'
import type { TabBarItem } from './TabBar'

export interface TabLinkProps {
  item: TabBarItem
  /** The class for whether the tab is on: its own path, or a screen inside it. */
  className: (on: boolean) => string
  /** The page to mark the tab for, when it isn't the URL's: the page a drawer is open over. */
  page?: string
  children: ReactNode
}

/** A click without a modifier, which would open the link elsewhere. Only the main button clicks. */
const plainClick = (event: MouseEvent) => !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey

/** Scrolls the page to the top: smoothly, or at once for a user who asked for less motion. */
function scrollToTop() {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
}

/**
 * A tab of the tab bar or the sidebar. It goes back to where the tab was left, with its query (the
 * Search tab's last search), and the screen restores its scroll (`useScrollRestoration`). Pressed on
 * the tab's own screen it scrolls that screen to the top instead; on a screen inside the tab (a
 * torrent under Downloads) it goes back to the tab's screen. The current one gets
 * aria-current="page".
 */
export function TabLink({ item, className, page, children }: TabLinkProps) {
  const { pathname, search: shown } = useLocation()
  const saved = useTabSearch(item.to)
  // On its own screen, the query shown: the place is saved only when the screen is left.
  const search = pathname === item.to ? shown : saved
  const onClick = (event: MouseEvent) => {
    if (pathname !== item.to || !plainClick(event)) return
    event.preventDefault()
    scrollToTop()
  }
  return (
    <NavLink
      to={item.to + search}
      state={TAB_RETURN}
      end
      onClick={onClick}
      className={({ isActive }) =>
        className(isTabOn(item, page === undefined ? isActive : page === item.to, page ?? pathname))
      }
    >
      {children}
    </NavLink>
  )
}
