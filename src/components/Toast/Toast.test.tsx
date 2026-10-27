import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('announces its message and goes away after a while', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Torrent deleted" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Torrent deleted')

    act(() => vi.advanceTimersByTime(3999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('stays as long as asked, and starts over when the message changes', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Toast message="Match confirmed" duration={1000} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(900))
    rerender(<Toast message="Title changed" duration={1000} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(900))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('never fires once gone', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Toast message="Cache cleared" onDismiss={onDismiss} />)
    unmount()
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
