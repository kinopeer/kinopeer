import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../../test/render'
import { PosterCard, PosterCardSkeleton } from './PosterCard'

describe('PosterCard', () => {
  it('shows the title, subtitle and a decorative poster', () => {
    const { container } = render(<PosterCard title="Dune" subtitle="Movie · 2021" posterUrl="/tmdb-img/w342/d.jpg" />)
    expect(screen.getByRole('heading', { name: 'Dune' })).toBeInTheDocument()
    expect(screen.getByText('Movie · 2021')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('falls back to a placeholder without a poster', () => {
    const { container } = render(<PosterCard title="Unknown" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.ks-poster-none')).not.toBeNull()
  })

  it('links the poster and text when given a target', () => {
    renderWithRouter(<PosterCard title="Dune" subtitle="Movie · 2021" to="/title/movie/438631" />)
    const link = screen.getByRole('link', { name: /Dune/ })
    expect(link).toHaveAttribute('href', '/title/movie/438631')
    expect(within(link).getByRole('heading', { name: 'Dune' })).toBeInTheDocument()
  })

  it('puts the overlay on the poster and the action outside the link', async () => {
    const onMore = vi.fn()
    const { container } = renderWithRouter(
      <PosterCard
        title="Dune"
        to="/torrent/abc"
        overlay={<span>Downloading</span>}
        action={
          <button type="button" onClick={onMore}>
            More
          </button>
        }
      />,
    )
    expect(container.querySelector('.ks-poster')).toHaveTextContent('Downloading')
    expect(container.querySelector('.ks-pcard')).toHaveClass('has-action')
    const more = screen.getByRole('button', { name: 'More' })
    expect(screen.getByRole('link')).not.toContainElement(more)
    await userEvent.click(more)
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('has a placeholder that screen readers skip', () => {
    const { container } = render(<PosterCardSkeleton />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})
