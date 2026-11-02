import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPage } from './holdPage'
import { stubTouchScreen } from './stubTouchScreen'
import { useScrollRestoration } from './useScrollRestoration'

function Screen({ ready }: { ready: boolean }) {
  useScrollRestoration(ready)
  return (
    <main>
      <h1>{ready ? 'Loaded' : 'Loading'}</h1>
      <Link to="/other">Open</Link>
    </main>
  )
}

function Other() {
  const navigate = useNavigate()
  return (
    <main>
      <h1>Other</h1>
      <button type="button" onClick={() => void navigate(-1)}>
        Back
      </button>
      <Link to="/">Home</Link>
    </main>
  )
}

/** The same router keeps its history across rerenders with another `ready`. */
function app(ready: boolean, path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Screen ready={ready} />} />
        <Route path="/other" element={<Other />} />
      </Routes>
    </MemoryRouter>
  )
}

const scrollTo = vi.fn()

function scrolledTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
}

beforeEach(() => {
  sessionStorage.clear()
  scrollTo.mockReset()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  scrolledTo(0)
})

afterEach(() => {
  scrolledTo(0)
  vi.unstubAllGlobals()
})

describe('useScrollRestoration', () => {
  it('restores the position on Back once the screen is ready', async () => {
    const user = userEvent.setup()
    const view = render(app(true))
    scrolledTo(640)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    // The browser clamps the scroll to the short, loading page.
    scrolledTo(120)

    view.rerender(app(false))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Loading' })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()

    view.rerender(app(true))
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('leaves a fresh navigation and the first load at the top', async () => {
    const user = userEvent.setup()
    const view = render(app(true, '/other'))
    scrolledTo(300)
    await user.click(screen.getByRole('link', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: 'Loaded' })).toBeInTheDocument()
    view.rerender(app(true))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('restores the position saved last, not the one from before the screen was ready', async () => {
    const user = userEvent.setup()
    const view = render(app(true))
    scrolledTo(500)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 500)

    scrolledTo(900)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 900)
    view.unmount()
  })

  it('saves where the page is while a modal holds the window at the top', async () => {
    stubTouchScreen()
    const user = userEvent.setup()
    render(app(true))
    scrolledTo(640)
    const release = holdPage()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    scrolledTo(0)

    await user.click(screen.getByRole('link', { name: 'Open' }))
    release()
    field.remove()
    scrollTo.mockClear()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
  })

  it('works under StrictMode, whose extra effect run must not save the clamped position', async () => {
    const user = userEvent.setup()
    const view = render(<StrictMode>{app(true)}</StrictMode>)
    scrolledTo(450)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    scrolledTo(60)
    view.rerender(<StrictMode>{app(false)}</StrictMode>)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).not.toHaveBeenCalled()

    view.rerender(<StrictMode>{app(true)}</StrictMode>)
    expect(scrollTo).toHaveBeenCalledWith(0, 450)
  })
})
