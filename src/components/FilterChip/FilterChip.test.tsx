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

  // The classes are the chip's contract with its stylesheet: is-on draws it picked, ks-chip-solid raised over content.
  it('draws a picked chip and a solid one by their classes', () => {
    render(
      <>
        <FilterChip selected>Picked</FilterChip>
        <FilterChip solid>Solid</FilterChip>
      </>,
    )
    const picked = screen.getByRole('button', { name: 'Picked' })
    const solid = screen.getByRole('button', { name: 'Solid' })
    expect(picked).toHaveClass('is-on')
    expect(picked).not.toHaveClass('ks-chip-solid')
    expect(solid).toHaveClass('ks-chip-solid')
    expect(solid).not.toHaveClass('is-on')
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
