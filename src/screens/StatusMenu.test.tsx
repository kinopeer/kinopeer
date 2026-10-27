import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { StatusFilter } from '../torrents/status'
import { StatusMenu } from './StatusMenu'

const COUNTS: Record<StatusFilter, number> = { all: 15, downloading: 1, seeding: 13, paused: 0, completed: 13, error: 2 }

function Harness({ initial = 'all', counts = COUNTS }: { initial?: StatusFilter; counts?: Record<StatusFilter, number> }) {
  const [value, setValue] = useState<StatusFilter>(initial)
  return <StatusMenu value={value} onChange={setValue} counts={counts} />
}

describe('StatusMenu', () => {
  it('shows the picked status and its count, and names it for screen readers', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Status: All, 15' })
    expect(button).toHaveTextContent('All statuses15')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists every status with its count and picks one', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Status: All, 15' }))
    expect(screen.getByRole('menu', { name: 'Filter by status' })).toBeInTheDocument()
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'All, 15',
      'Downloading, 1',
      'Seeding, 13',
      'Paused, 0',
      'Completed, 13',
      'Error, 2',
    ])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[0]).toHaveFocus()

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Seeding, 13' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: /^Status: Seeding, 13/ })
    expect(button).toHaveFocus()
    expect(button).toHaveTextContent('Seeding13')

    await userEvent.click(button)
    expect(screen.getByRole('menuitemradio', { name: 'Seeding, 13' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Seeding, 13' })).toHaveFocus()
    expect(screen.getByRole('menuitemradio', { name: 'All, 15' })).toHaveAttribute('aria-checked', 'false')
  })

  // The error mark is in the button's name: "With errors" shows only when another status hides them.
  it('marks the button when another status hides torrents with errors', async () => {
    render(<Harness initial="seeding" />)
    expect(screen.getByRole('button', { name: 'Status: Seeding, 13. With errors: 2' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Status: Seeding/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Error, 2' }))
    expect(screen.getByRole('button', { name: 'Status: Error, 2' })).toBeInTheDocument()
  })

  it('has no error mark when nothing has errors, or when all statuses show', () => {
    const { rerender } = render(<Harness initial="seeding" counts={{ ...COUNTS, error: 0 }} />)
    expect(screen.getByRole('button', { name: 'Status: Seeding, 13' })).toBeInTheDocument()

    rerender(<StatusMenu value="all" onChange={vi.fn()} counts={COUNTS} />)
    expect(screen.getByRole('button', { name: 'Status: All, 15' })).toBeInTheDocument()
  })

  it('leaves the counts out while loading', async () => {
    render(<StatusMenu value="all" onChange={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Status: All' })
    expect(button).toHaveTextContent(/^All statuses$/)
    await userEvent.click(button)
    expect(screen.getByRole('menuitemradio', { name: 'Seeding' })).toBeInTheDocument()
  })
})
