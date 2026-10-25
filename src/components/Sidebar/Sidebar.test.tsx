import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { TabBarItem } from '../TabBar'
import { Sidebar } from './Sidebar'

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
})
