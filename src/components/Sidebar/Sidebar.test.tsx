import { cleanup, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '../../test/render'
import type { TabBarItem } from '../TabBar'
import { Sidebar } from './Sidebar'
import { SidebarStatus } from './SidebarStatus'

const items: TabBarItem[] = [
  { to: '/', icon: 'download', label: 'Downloads', also: ['/torrent/'] },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]

function renderSidebar(path: string, pathname?: string) {
  renderWithRouter(<Sidebar label="Main" items={items} pathname={pathname} />, [path])
  return screen.getByRole('navigation', { name: 'Main' })
}

describe('Sidebar', () => {
  it('links to every destination with its label and marks the current one', () => {
    const nav = renderSidebar('/search')
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveClass('is-on')
    expect(within(nav).getByRole('link', { name: 'Downloads' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('highlights an item for the screens inside it', () => {
    const nav = renderSidebar('/torrent/abc')
    // Which screens count is isTabOn's (isTabOn.test.ts); the item shows it with its class.
    expect(within(nav).getByRole('link', { name: 'Downloads' })).toHaveClass('is-on')
  })

  it('marks the item of the page a drawer is open over, rather than the URL’s', () => {
    let nav = renderSidebar('/torrent/abc', '/title/movie/1')
    expect(within(nav).getByRole('link', { name: 'Downloads' })).not.toHaveClass('is-on')
    expect(within(nav).getByRole('link', { name: 'Search' })).not.toHaveClass('is-on')
    cleanup()

    nav = renderSidebar('/torrent/abc', '/search')
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveClass('is-on')
    expect(within(nav).getByRole('link', { name: 'Downloads' })).not.toHaveClass('is-on')
  })

  it('shows a count after an item, read out with its meaning, and a footer', () => {
    renderWithRouter(
      <Sidebar
        label="Main"
        items={[{ ...items[0], count: { value: 2, label: '2 downloading' } }, ...items.slice(1)]}
        footer={<p>Status</p>}
      />,
    )
    expect(screen.getByRole('link', { name: /^Downloads.*2 downloading$/ })).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})

describe('SidebarStatus', () => {
  it('shows qBittorrent’s version, total speeds and free space', () => {
    render(<SidebarStatus version="v5.0.1" offline={false} downloadSpeed={4_300_000} uploadSpeed={120_000} freeSpace={1_210_000_000_000} />)
    const card = screen.getByRole('region', { name: 'qBittorrent' })
    expect(within(card).getAllByText('qBittorrent v5.0.1')).toHaveLength(2)
    expect(card).toHaveTextContent('↓Download speed 4.3 MB/s')
    expect(card).toHaveTextContent('↑Upload speed 120 KB/s')
    expect(within(card).getByText('1.21 TB free')).toBeInTheDocument()
  })

  it('stacks each number over its unit for the rail', () => {
    render(<SidebarStatus version="v5.0.1" offline={false} downloadSpeed={4_300_000} uploadSpeed={120_000} freeSpace={1_210_000_000_000} />)
    const download = screen.getByText('MB/s').closest('p')
    expect(download).toHaveTextContent(/^↓Download speed 4\.3MB\/s$/)
    expect(screen.getByText('KB/s').closest('p')).toHaveTextContent(/^↑Upload speed 120KB\/s$/)
    expect(screen.getByText('TB').closest('p')).toHaveTextContent(/^Free space 1\.21TB$/)
    expect(screen.getByTitle('qBittorrent v5.0.1')).toBeInTheDocument()
  })

  it('says when qBittorrent doesn’t answer', () => {
    render(<SidebarStatus version="v5.0.1" offline downloadSpeed={4_300_000} />)
    // In the card and in the rail's column.
    expect(screen.getAllByText('No connection to qBittorrent')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'qBittorrent' })).toHaveTextContent('↓Download speed —')
    expect(screen.queryByText('TB')).not.toBeInTheDocument()
  })
})
