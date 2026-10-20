import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'
import { ICONS } from './icons'

describe('Icon', () => {
  it('is decorative without a label', () => {
    const { container } = render(<Icon name="download" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg.querySelector('path')).toHaveAttribute('d', ICONS.download)
  })

  it('is exposed as an image when labelled', () => {
    render(<Icon name="star" label="Rating" />)
    expect(screen.getByRole('img', { name: 'Rating' })).toBeInTheDocument()
  })

  it('uses a heavier default stroke for dot glyphs', () => {
    const { container } = render(<Icon name="more" />)
    expect(container.querySelector('svg')).toHaveStyle({ strokeWidth: '2.6' })
  })

  it('applies the size', () => {
    const { container } = render(<Icon name="search" size={24} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '24')
  })
})
