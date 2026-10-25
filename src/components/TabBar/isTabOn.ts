import type { TabBarItem } from './TabBar'

/** Whether a tab is the current one: its own path, or a screen inside it. Shared with the Sidebar. */
export function isTabOn(item: TabBarItem, isActive: boolean, pathname: string): boolean {
  return isActive || !!item.also?.some((prefix) => pathname.startsWith(prefix))
}
