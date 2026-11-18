import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InDownloadsMark } from './InDownloadsMark'

/** The mark over a card's poster, inside the card's link as PosterCard puts it. */
function renderInLink(mark: Parameters<typeof InDownloadsMark>[0]['mark']) {
  render(
    <a href="/title/movie/1">
      Dune <InDownloadsMark mark={mark} />
    </a>,
  )
  return screen.getByRole('link')
}

describe('InDownloadsMark', () => {
  it('names the card with the title page’s words for one torrent, and shows its bare progress', () => {
    const link = renderInLink({ progress: 0.625 })
    expect(link).toHaveAccessibleName('Dune In downloads · 62%')
    // The figure is what the card shows; a screen reader hears the words instead of it.
    expect(screen.getByText('62%')).toHaveAttribute('aria-hidden', 'true')
    // `sr-only` is what keeps the words off the screen (base.css), which no role or attribute shows.
    expect(screen.getByText('In downloads · 62%')).toHaveClass('sr-only')
  })

  it('names the card with the words for several torrents, and shows their bare count', () => {
    const link = renderInLink({ count: 3 })
    expect(link).toHaveAccessibleName('Dune In downloads · 3')
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
    // As above: the class is what hides the words from sight.
    expect(screen.getByText('In downloads · 3')).toHaveClass('sr-only')
  })
})
