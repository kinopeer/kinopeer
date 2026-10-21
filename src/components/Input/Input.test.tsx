import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input', () => {
  it('is labelled and described by its hint', () => {
    render(<Input label="URL" help="Web UI address" />)
    const input = screen.getByLabelText('URL')
    expect(input).toHaveAccessibleDescription('Web UI address')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('replaces the hint with an error message', () => {
    render(<Input label="API key" help="From Settings" error="401 Unauthorized" />)
    const input = screen.getByLabelText('API key')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('401 Unauthorized')
    expect(input).toHaveClass('is-error')
  })

  it('can be marked invalid without a message', () => {
    render(<Input label="Username" error />)
    const input = screen.getByLabelText('Username')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})
