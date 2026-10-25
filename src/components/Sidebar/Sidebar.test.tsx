import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { TabBarItem } from '../TabBar'
import { Sidebar } from './Sidebar'
import { SidebarStatus } from './SidebarStatus'

const items: TabBarItem[] = [
  { to: '/', icon: 'download', label: 'Downloads', also: ['/torrent/'] },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]

function renderSidebar(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar label="Main" items={items} />
    </MemoryRouter>,
  )
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
    expect(within(nav).getByRole('link', { name: 'Downloads' })).toHaveClass('is-on')
    expect(within(nav).getByRole('link', { name: 'Search' })).not.toHaveClass('is-on')
  })

  it('shows a count after an item, read out with its meaning, and a footer', () => {
    render(
      <MemoryRouter>
        <Sidebar
          label="Main"
          items={[{ ...items[0], count: { value: 2, label: '2 downloading' } }, ...items.slice(1)]}
          footer={<p>Status</p>}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /^Downloads.*2 downloading$/ })).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})

describe('SidebarStatus', () => {
  it('shows qBittorrent’s version, total speeds and free space', () => {
    render(<SidebarStatus version="v5.0.1" offline={false} downloadSpeed={4_300_000} uploadSpeed={120_000} freeSpace={1_210_000_000_000} />)
    const card = screen.getByRole('region', { name: 'qBittorrent' })
    expect(within(card).getByText('qBittorrent v5.0.1')).toBeInTheDocument()
    expect(card).toHaveTextContent('↓Download speed 4.3 MB/s')
    expect(card).toHaveTextContent('↑Upload speed 120 KB/s')
    expect(within(card).getByText('1.21 TB free')).toBeInTheDocument()
  })

  it('says when qBittorrent doesn’t answer', () => {
    render(<SidebarStatus version="v5.0.1" offline downloadSpeed={4_300_000} />)
    expect(screen.getByText('No connection to qBittorrent')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'qBittorrent' })).toHaveTextContent('↓Download speed —')
  })
})
