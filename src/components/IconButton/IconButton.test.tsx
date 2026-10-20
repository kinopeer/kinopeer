import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('is named by its label', () => {
    render(<IconButton icon="more" label="More actions" />)
    const button = screen.getByRole('button', { name: 'More actions' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-pressed')
  })

  it('exposes toggle state when active is set', () => {
    const { rerender } = render(<IconButton icon="search" label="Search" active={false} />)
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-pressed', 'false')

    rerender(<IconButton icon="search" label="Search" active />)
    const button = screen.getByRole('button', { name: 'Search' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveClass('is-on')
  })

  it('applies variant and size classes and a smaller icon at sm', () => {
    render(<IconButton icon="close" label="Close" variant="glass" size="sm" />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button).toHaveClass('ks-icon-btn-glass', 'ks-icon-btn-sm')
    expect(button.querySelector('svg')).toHaveAttribute('width', '18')
  })
})
