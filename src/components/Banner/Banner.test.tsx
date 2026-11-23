import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Banner } from './Banner'

describe('Banner', () => {
  it('announces errors as alerts', () => {
    render(<Banner tone="error" title="Unreachable">Check qBittorrent</Banner>)
    expect(screen.getByRole('alert')).toHaveTextContent('UnreachableCheck qBittorrent')
  })

  it('announces other tones politely', () => {
    render(<Banner>Offline</Banner>)
    expect(screen.getByRole('status')).toHaveTextContent('Offline')
  })

  it('leaves announcing to a live region around it', () => {
    render(<Banner live={false}>Offline</Banner>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('renders the action', async () => {
    const onAction = vi.fn()
    render(<Banner actionLabel="Retry" onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('renders a second action after the first, each with its own handler', async () => {
    const onAction = vi.fn()
    const onSecondaryAction = vi.fn()
    render(<Banner actionLabel="Retry" onAction={onAction} secondaryActionLabel="Open again" onSecondaryAction={onSecondaryAction} />)
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveAccessibleName('Retry')
    expect(second).toHaveAccessibleName('Open again')
    await userEvent.click(second)
    expect(onSecondaryAction).toHaveBeenCalledOnce()
    expect(onAction).not.toHaveBeenCalled()
  })

  // The classes are the component's contract with its stylesheet (the design system's ks-banner).
  it('takes its tone’s class, the warning being the plain banner', () => {
    const { container, rerender } = render(<Banner tone="error">Failed</Banner>)
    expect(container.firstElementChild).toHaveClass('ks-banner', 'ks-banner-error')
    rerender(<Banner tone="warning">Low</Banner>)
    expect(container.firstElementChild).toHaveClass('ks-banner')
    expect(container.firstElementChild?.className).not.toMatch(/ks-banner-/)
  })

  it('puts its actions under the text with two of them or when asked, not with one', () => {
    const { container, rerender } = render(<Banner actionLabel="Retry" onAction={vi.fn()} />)
    expect(container.firstElementChild).not.toHaveClass('wraps-actions')
    rerender(<Banner actionLabel="Free up space" onAction={vi.fn()} wrapActions />)
    expect(container.firstElementChild).toHaveClass('wraps-actions')
    rerender(<Banner actionLabel="Retry" onAction={vi.fn()} secondaryActionLabel="Open again" onSecondaryAction={vi.fn()} />)
    expect(container.firstElementChild).toHaveClass('wraps-actions')
  })
})
