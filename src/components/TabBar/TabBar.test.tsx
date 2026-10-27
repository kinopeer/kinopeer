import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '../../test/render'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  it('marks the current tab', () => {
    renderWithRouter(
      <TabBar
        label="Main"
        items={[
          { to: '/', icon: 'download', label: 'Downloads' },
          { to: '/search', icon: 'search', label: 'Search' },
        ]}
      />,
      ['/search'],
    )
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Downloads' })).not.toHaveAttribute('aria-current')
  })

  it('highlights a tab for the screens inside it', () => {
    renderWithRouter(
      <TabBar
        label="Main"
        items={[
          { to: '/', icon: 'download', label: 'Downloads', also: ['/torrent/'] },
          { to: '/search', icon: 'search', label: 'Search' },
        ]}
      />,
      ['/torrent/abc'],
    )
    expect(screen.getByRole('link', { name: 'Downloads' })).toHaveClass('is-on')
    expect(screen.getByRole('link', { name: 'Search' })).not.toHaveClass('is-on')
  })
})
