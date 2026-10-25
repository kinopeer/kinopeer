import { NavLink, useLocation } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon } from '../Icon'
import { isTabOn, type TabBarItem } from '../TabBar'
import './Sidebar.css'

export interface SidebarProps {
  /** The same destinations as the tab bar's. */
  items: TabBarItem[]
  /** Accessible name of the navigation landmark. */
  label: string
}

/**
 * Desktop navigation in place of the tab bar, fixed along the left edge: an icon rail up to 1100px,
 * then with labels. The current item gets aria-current="page".
 */
export function Sidebar({ items, label }: SidebarProps) {
  const { pathname } = useLocation()
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
              cx('ks-nav', isTabOn(item, isActive, pathname) && 'is-on')
            }>
            <Icon name={item.icon} size={22} />
            <span className="ks-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
