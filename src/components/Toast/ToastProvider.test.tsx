import { act, render, screen, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from './ToastProvider'
import { useToast, useToastLayer, type Toasts } from './useToast'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

let toasts: Toasts

/** Hands the test `show`, to call with whatever message it needs. */
function Shows() {
  const toast = useToast()
  useEffect(() => {
    toasts = toast
  }, [toast])
  return null
}

/** A modal that registers as a layer while open. */
function Layer({ open, name = 'Sheet' }: { open: boolean; name?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useToastLayer(ref, open)
  return <dialog ref={ref} aria-label={name} open={open} />
}

const messages = () => screen.queryAllByRole('status').map((toast) => toast.textContent)

describe('ToastProvider', () => {
  it('stacks toasts, newest last, and pushes the oldest out past three', () => {
    render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    )
    act(() => toasts.show('Moving files to /media'))
    act(() => toasts.show('Checking the files'))
    expect(messages()).toEqual(['Moving files to /media', 'Checking the files'])
    act(() => toasts.show('Title changed'))
    act(() => toasts.show('Couldn’t reach qBittorrent. Try again.'))
    expect(messages()).toEqual(['Checking the files', 'Title changed', 'Couldn’t reach qBittorrent. Try again.'])
    // The pushed-out toast's times went with it: two for each toast left (slid in, gone).
    expect(vi.getTimerCount()).toBe(6)
  })

  it('takes each toast away after its own time', () => {
    render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    )
    act(() => toasts.show('Moving files to /media'))
    act(() => vi.advanceTimersByTime(3000))
    act(() => toasts.show('Checking the files'))
    act(() => vi.advanceTimersByTime(1000))
    expect(messages()).toEqual(['Checking the files'])
    act(() => vi.advanceTimersByTime(3000))
    expect(messages()).toEqual([])
  })

  it('shows the same message once, as the newest, its time starting over', () => {
    render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    )
    act(() => toasts.show('Couldn’t reach qBittorrent. Try again.'))
    act(() => toasts.show('Checking the files'))
    act(() => vi.advanceTimersByTime(3000))
    act(() => toasts.show('Couldn’t reach qBittorrent. Try again.'))
    expect(messages()).toEqual(['Checking the files', 'Couldn’t reach qBittorrent. Try again.'])
    act(() => vi.advanceTimersByTime(3000))
    expect(messages()).toEqual(['Couldn’t reach qBittorrent. Try again.'])
  })

  it('shows toasts inside the top open modal, where they aren’t behind its backdrop, and outside once it closes', () => {
    const { rerender } = render(
      <ToastProvider>
        <Shows />
        <Layer open />
      </ToastProvider>,
    )
    act(() => toasts.show('Checking the files'))
    expect(within(screen.getByRole('dialog', { name: 'Sheet' })).getByRole('status')).toHaveTextContent('Checking the files')

    rerender(
      <ToastProvider>
        <Shows />
        <Layer open={false} />
      </ToastProvider>,
    )
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Checking the files')
    expect(toast.closest('dialog')).toBeNull()
  })

  it('picks the modal opened last when one is over another, as a sheet over the drawer', () => {
    render(
      <ToastProvider>
        <Shows />
        <Layer open name="Drawer" />
        <Layer open />
      </ToastProvider>,
    )
    act(() => toasts.show('Checking the files'))
    expect(within(screen.getByRole('dialog', { name: 'Sheet' })).getByRole('status')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Drawer' })).queryByRole('status')).not.toBeInTheDocument()
  })

  it('replaces a toast with the same key, though its message differs, and takes it back by key', () => {
    render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    )
    act(() => toasts.show('Couldn’t pause', { key: 'pause' }))
    act(() => toasts.show('Checking the files'))
    act(() => toasts.show('Couldn’t reach qBittorrent', { key: 'pause' }))
    expect(messages()).toEqual(['Checking the files', 'Couldn’t reach qBittorrent'])
    act(() => toasts.dismiss('pause'))
    expect(messages()).toEqual(['Checking the files'])
  })

  it('keeps a toast’s time when a modal opens over it and it moves inside', () => {
    const { rerender } = render(
      <ToastProvider>
        <Shows />
        <Layer open={false} />
      </ToastProvider>,
    )
    act(() => toasts.show('Checking the files'))
    act(() => vi.advanceTimersByTime(3000))
    rerender(
      <ToastProvider>
        <Shows />
        <Layer open />
      </ToastProvider>,
    )
    expect(within(screen.getByRole('dialog', { name: 'Sheet' })).getByRole('status')).toBeInTheDocument()
    // Gone 4 s after it was shown, not 4 s after it moved.
    act(() => vi.advanceTimersByTime(1000))
    expect(messages()).toEqual([])
  })

  it('marks a toast settled once it has slid in, so shown again in another layer it doesn’t slide in again', () => {
    render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    )
    act(() => toasts.show('Checking the files'))
    // `is-settled` is what turns the slide-in off (Toast.css): a toast moved into a modal is drawn anew.
    expect(screen.getByRole('status')).not.toHaveClass('is-settled')
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByRole('status')).toHaveClass('is-settled')
  })
})
