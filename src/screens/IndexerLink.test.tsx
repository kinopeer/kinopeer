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
})
