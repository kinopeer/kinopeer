import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '../../test/render'
import { IconButton, IconLink } from './IconButton'

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

  it('shows a dot that says why as the button’s description, its name unchanged', () => {
    const { container, rerender } = render(<IconButton icon="more" label="More actions" />)
    expect(screen.getByRole('button', { name: 'More actions' })).not.toHaveAccessibleDescription()
    // The dot is a span its class draws; no role or attribute says it's there.
    expect(container.querySelector('.ks-icon-btn-dot')).toBeNull()

    rerender(<IconButton icon="more" label="More actions" dot="Not matched to a movie" />)
    const button = screen.getByRole('button', { name: 'More actions' })
    expect(button).toHaveAccessibleDescription('Not matched to a movie')
    expect(container.querySelector('.ks-icon-btn-dot')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('Not matched to a movie')).not.toBeVisible()
  })

  it('keeps a description it was given beside the dot’s', () => {
    render(
      <>
        <IconButton icon="more" label="More actions" dot="Not matched to a movie" aria-describedby="other" />
        <p id="other">Paused</p>
      </>,
    )
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAccessibleDescription('Paused Not matched to a movie')
  })
})

describe('IconLink', () => {
  it('is a link named by its label that looks like an IconButton of its variant, size and state', () => {
    renderWithRouter(<IconLink to="/torrent/a1" icon="check" label="In downloads" variant="filled" size="sm" on className="own" />)
    const link = screen.getByRole('link', { name: 'In downloads' })
    expect(link).toHaveAttribute('href', '/torrent/a1')
    expect(link).toHaveClass('ks-icon-btn', 'ks-icon-btn-filled', 'ks-icon-btn-sm', 'is-on', 'own')
    expect(link.querySelector('svg')).toHaveAttribute('width', '18')
  })

  it('defaults to a plain md one, its icon 20px or the size it’s given', () => {
    renderWithRouter(
      <>
        <IconLink to="/" icon="check" label="In downloads" />
        <IconLink to="/" icon="check" label="Larger" iconSize={22} />
      </>,
    )
    const link = screen.getByRole('link', { name: 'In downloads' })
    expect(link).toHaveAttribute('class', 'ks-icon-btn')
    expect(link.querySelector('svg')).toHaveAttribute('width', '20')
    expect(screen.getByRole('link', { name: 'Larger' }).querySelector('svg')).toHaveAttribute('width', '22')
  })
})
