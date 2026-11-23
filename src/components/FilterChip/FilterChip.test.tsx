import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterChip } from './FilterChip'

describe('FilterChip', () => {
  it('is a toggle button with a count', async () => {
    const onClick = vi.fn()
    render(
      <FilterChip selected count={3} onClick={onClick}>
        Seeding
      </FilterChip>,
    )
    const chip = screen.getByRole('button', { name: 'Seeding 3', pressed: true })
    await userEvent.click(chip)
    expect(onClick).toHaveBeenCalled()
  })

  it('is not pressed by default', () => {
    render(<FilterChip>All</FilterChip>)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('dims a chip that isn’t selected, which stays pressable', async () => {
    const onClick = vi.fn()
    render(
      <>
        <FilterChip dim count={0} onClick={onClick}>
          720p
        </FilterChip>
        <FilterChip count={2}>2160p</FilterChip>
      </>,
    )
    const dimmed = screen.getByRole('button', { name: '720p 0' })
    expect(dimmed).toHaveClass('is-dim')
    expect(dimmed).toBeEnabled()
    await userEvent.click(dimmed)
    expect(onClick).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '2160p 2' })).not.toHaveClass('is-dim')
  })
})
