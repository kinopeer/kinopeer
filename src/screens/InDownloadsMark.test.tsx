import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InDownloadsMark } from './InDownloadsMark'

describe('InDownloadsMark', () => {
  it('shows nothing for a title with no torrents', () => {
    const { container, rerender } = render(<InDownloadsMark torrents={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<InDownloadsMark torrents={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows one torrent's progress, and says the title page's words to a screen reader", () => {
    render(<InDownloadsMark torrents={[{ progress: 0.62 }]} />)
    expect(screen.getByText('62%')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('In downloads · 62%')).toHaveClass('sr-only')
  })

  it('shows the count of several torrents, and says the words to a screen reader', () => {
    render(<InDownloadsMark torrents={[{ progress: 0.1 }, { progress: 1 }, { progress: 0.5 }]} />)
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('In downloads · 3')).toHaveClass('sr-only')
  })
})
