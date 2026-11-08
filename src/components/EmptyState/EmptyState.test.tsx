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

  it('renders a second action after the first, each with its own handler', async () => {
    const onAction = vi.fn()
    const onSecondaryAction = vi.fn()
    render(<EmptyState icon="wifi-off" title="Can’t reach Kinopeer" actionLabel="Try again" onAction={onAction} secondaryActionLabel="Open again" onSecondaryAction={onSecondaryAction} />)
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveAccessibleName('Try again')
    expect(second).toHaveAccessibleName('Open again')
    await userEvent.click(second)
    expect(onSecondaryAction).toHaveBeenCalledOnce()
    expect(onAction).not.toHaveBeenCalled()
  })
})
