import { NavLink, useLocation } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './TabBar.css'

export interface TabBarItem {
  to: string
  icon: IconName
  label: string
  /** Path prefixes of screens inside this tab, e.g. a torrent's page under Downloads. */
  also?: string[]
}

export interface TabBarProps {
  items: TabBarItem[]
  /** Accessible name of the navigation landmark. */
  label: string
}

/** Bottom navigation for phones. The current tab gets aria-current="page". */
export function TabBar({ items, label }: TabBarProps) {
  const { pathname } = useLocation()
  return (
    <nav className="ks-tabbar" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end className={({ isActive }) =>
            cx('ks-tab', (isActive || item.also?.some((prefix) => pathname.startsWith(prefix))) && 'is-on')
          }>
          <Icon name={item.icon} size={24} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
