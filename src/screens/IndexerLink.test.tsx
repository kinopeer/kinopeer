import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IndexerLink } from './IndexerLink'

describe('IndexerLink', () => {
  it('links the indexer name to the release page on the tracker, in a new tab', () => {
    render(<IndexerLink release={{ indexer: 'Indexer A', infoUrl: 'https://indexer-a.example.org/release/1' }} />)
    const link = screen.getByRole('link', { name: 'Open on Indexer A' })
    expect(link).toHaveAttribute('href', 'https://indexer-a.example.org/release/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('Indexer A')
  })

  it('shows the name as text when the release has no page', () => {
    render(<IndexerLink release={{ indexer: 'Indexer A' }} />)
    expect(screen.getByText('Indexer A')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links a plain http page too', () => {
    render(<IndexerLink release={{ indexer: 'Indexer A', infoUrl: 'http://indexer-a.example.org/release/1' }} />)
    expect(screen.getByRole('link', { name: 'Open on Indexer A' })).toHaveAttribute('href', 'http://indexer-a.example.org/release/1')
  })

  // The page comes from the indexer through Prowlarr: a javascript: URL would run in Kinopeer's
  // origin when clicked (#292), so only http(s) pages become links.
  it.each([
    ['a javascript: URL', 'javascript:alert(document.domain)'],
    ['one in capitals with spaces before it', '  JavaScript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a relative path, which would open a page of Kinopeer', '/qbt/api/v2/app/version'],
    ['something that is not a URL', 'not a url'],
  ])('shows the name as text when the page is %s', (_, infoUrl) => {
    render(<IndexerLink release={{ indexer: 'Indexer A', infoUrl }} />)
    expect(screen.getByText('Indexer A')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
