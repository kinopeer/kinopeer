import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  it('marks the current tab', () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <TabBar
          label="Main"
          items={[
            { to: '/', icon: 'download', label: 'Downloads' },
            { to: '/search', icon: 'search', label: 'Search' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Downloads' })).not.toHaveAttribute('aria-current')
  })
})
