import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import { TabLink } from './TabLink'
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

/** Bottom navigation for phones, with the tabs `TabLink` describes. */
export function TabBar({ items, label }: TabBarProps) {
  return (
    <nav className="ks-tabbar" aria-label={label}>
      {items.map((item) => (
        <TabLink key={item.to} item={item} className={(on) => cx('ks-tab', on && 'is-on')}>
          <Icon name={item.icon} size={24} />
          <span>{item.label}</span>
        </TabLink>
      ))}
    </nav>
  )
}
