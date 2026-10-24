import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MatchPrompt } from './MatchPrompt'

describe('MatchPrompt', () => {
  it('asks whether a guessed title is right', async () => {
    const onChange = vi.fn()
    const onConfirm = vi.fn()
    render(<MatchPrompt kind="guess" onChange={onChange} onConfirm={onConfirm} />)
    expect(screen.getByText('Matched by the release name. Is it right?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(onChange).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, right' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('blocks both buttons while the confirmation is saved', () => {
    render(<MatchPrompt kind="guess" busy onChange={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Change' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Yes, right' })).toHaveAttribute('aria-busy', 'true')
  })

  it('offers to pick a title when none was found', async () => {
    const onChange = vi.fn()
    render(<MatchPrompt kind="none" onChange={onChange} />)
    expect(screen.getByText('No title found for this release.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, right' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pick title' }))
    expect(onChange).toHaveBeenCalledOnce()
  })
})
