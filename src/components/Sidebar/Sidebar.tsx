import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon } from '../Icon'
import { isTabOn, type TabBarItem } from '../TabBar'
import './Sidebar.css'

export interface SidebarItem extends TabBarItem {
  /** A number after the label, such as how many torrents are downloading; a badge on the icon in the rail. */
  count?: { value: number; label: string }
}

export interface SidebarProps {
  /** The same destinations as the tab bar's. */
  items: SidebarItem[]
  /** Accessible name of the navigation landmark. */
  label: string
  /** At the bottom, e.g. the qBittorrent status, which has its own look for the rail. */
  footer?: ReactNode
  /** The page to mark the item for, when it isn't the URL's: the page a drawer is open over. */
  pathname?: string
}

/**
 * Desktop navigation in place of the tab bar, fixed along the left edge: an icon rail up to 1100px,
 * then with labels. The current item gets aria-current="page".
 */
export function Sidebar({ items, label, footer, pathname: page }: SidebarProps) {
  const location = useLocation()
  const pathname = page ?? location.pathname
  return (
    <div className="ks-side">
      <div className="ks-side-brand">
        <img src="/icons/icon-192.png" alt="" width={34} height={34} />
        <span className="ks-side-wordmark">
          kino<span>seed</span>
        </span>
      </div>
      <nav className="ks-side-nav" aria-label={label}>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) =>
              cx('ks-nav', isTabOn(item, page === undefined ? isActive : page === item.to, pathname) && 'is-on')
            }>
            <Icon name={item.icon} size={22} />
            <span className="ks-nav-label">{item.label}</span>
            {item.count && (
              <span className="ks-nav-count">
                <span aria-hidden="true">{item.count.value}</span>
                <span className="sr-only">, {item.count.label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      {footer && <div className="ks-side-foot">{footer}</div>}
    </div>
  )
}
