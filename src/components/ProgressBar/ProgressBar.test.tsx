import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('exposes the value as a percentage', () => {
    render(<ProgressBar value={0.426} status="paused" label="Dune: progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Dune: progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar.firstElementChild).toHaveClass('b-paused')
    expect(bar.firstElementChild).toHaveStyle({ width: '42.6%' })
  })

  it('is indeterminate without a value', () => {
    render(<ProgressBar label="Checking" />)
    const bar = screen.getByRole('progressbar', { name: 'Checking' })
    expect(bar).toHaveClass('is-indet')
    expect(bar).not.toHaveAttribute('aria-valuenow')
  })
})
