import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusChip } from './StatusChip'

describe('StatusChip', () => {
  it('renders the label with the status style', () => {
    render(<StatusChip status="seeding">Seeding</StatusChip>)
    expect(screen.getByText('Seeding')).toHaveClass('ks-status', 'st-seeding')
  })
})
