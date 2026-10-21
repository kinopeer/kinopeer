import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PosterCard } from './PosterCard'

describe('PosterCard', () => {
  it('shows the title, subtitle and a decorative poster', () => {
    const { container } = render(<PosterCard title="Dune" subtitle="Movie · 2021" posterUrl="/tmdb-img/w342/d.jpg" />)
    expect(screen.getByRole('heading', { name: 'Dune' })).toBeInTheDocument()
    expect(screen.getByText('Movie · 2021')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('falls back to a placeholder without a poster', () => {
    const { container } = render(<PosterCard title="Unknown" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.ks-poster-none')).not.toBeNull()
  })
})
