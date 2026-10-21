import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title, body and action', async () => {
    const onAction = vi.fn()
    render(
      <EmptyState icon="filter" title="Nothing matches" actionLabel="Reset filters" onAction={onAction}>
        No torrents match these filters.
      </EmptyState>,
    )
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    expect(screen.getByText('No torrents match these filters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(onAction).toHaveBeenCalled()
  })
})
