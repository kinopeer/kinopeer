import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAB_RETURN, forgetTabPlaces, saveTabPlace, tabPlace } from './tabPlaces'
import { useNewScreenAtTop, useScrollRestoration } from './useScrollRestoration'

function Screen({ ready }: { ready: boolean }) {
  useScrollRestoration(ready, '/')
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
  forgetTabPlaces()
  scrollTo.mockReset()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  scrolledTo(0)
})

afterEach(() => {
  scrolledTo(0)
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

/** A tab's screen: Downloads at `/`, which a drawer at `/drawer` keeps mounted, as on desktop. */
function TabScreen({ ready }: { ready: boolean }) {
  useScrollRestoration(ready, '/')
  const navigate = useNavigate()
  return (
    <main>
      <h1>{ready ? 'Loaded' : 'Loading'}</h1>
      <button type="button" onClick={() => void navigate(-1)}>
        Back
      </button>
      <Link to="/other">Open</Link>
      <Link to="/drawer">Drawer</Link>
      <Link to="/?q=andor" replace>
        Type
      </Link>
      <Link to="/" state={TAB_RETURN}>
        Its tab
      </Link>
    </main>
  )
}

/** Another tab's screen, with the first tab's link, Back and a fresh link to the first tab's path. */
function OtherTab() {
  const navigate = useNavigate()
  return (
    <main>
      <h1>Other</h1>
      <Link to="/?q=dune" state={TAB_RETURN}>
        Tab
      </Link>
      <Link to="/">Fresh</Link>
      <button type="button" onClick={() => void navigate(-1)}>
        Back
      </button>
    </main>
  )
}

function tabApp(ready: boolean, path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<TabScreen ready={ready} />}>
          <Route index />
          <Route path="drawer" />
        </Route>
        <Route path="/other" element={<OtherTab />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('useScrollRestoration on a tab’s screen', () => {
  it('brings the screen back to where its tab was left once it’s ready, and keeps the tab’s query', async () => {
    const user = userEvent.setup()
    const view = render(tabApp(true, '/?q=dune'))
    scrolledTo(640)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(tabPlace('/')).toEqual({ search: '?q=dune', y: 640 })
    // The next screen is shorter, so the window is clamped.
    scrolledTo(120)

    view.rerender(tabApp(false, '/?q=dune'))
    await user.click(screen.getByRole('link', { name: 'Tab' }))
    expect(screen.getByRole('heading', { name: 'Loading' })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()

    view.rerender(tabApp(true, '/?q=dune'))
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('keeps the query the screen showed last, once, as it goes away', async () => {
    const user = userEvent.setup()
    render(tabApp(true, '/?q=dune'))
    // As a query typed into Search replaces the entry.
    await user.click(screen.getByRole('link', { name: 'Type' }))
    expect(tabPlace('/')).toBeUndefined()
    scrolledTo(300)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(tabPlace('/')).toEqual({ search: '?q=andor', y: 300 })
  })

  it('opens a tab never left at the top at once, without waiting for its content', async () => {
    const user = userEvent.setup()
    const view = render(tabApp(true, '/other'))
    scrolledTo(300)
    view.rerender(tabApp(false, '/other'))
    await user.click(screen.getByRole('link', { name: 'Tab' }))
    expect(screen.getByRole('heading', { name: 'Loading' })).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves a fresh link to the tab’s path to the new screen’s top', async () => {
    const user = userEvent.setup()
    saveTabPlace('/', { search: '', y: 640 })
    render(tabApp(true, '/other'))
    await user.click(screen.getByRole('link', { name: 'Fresh' }))
    expect(screen.getByRole('heading', { name: 'Loaded' })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves a screen already shown where it is', async () => {
    const user = userEvent.setup()
    render(tabApp(true))
    scrolledTo(500)
    await user.click(screen.getByRole('link', { name: 'Drawer' }))
    scrolledTo(700)
    await user.click(screen.getByRole('link', { name: 'Its tab' }))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('brings an entry back to its own position on Back, not to where its tab was left last', async () => {
    const user = userEvent.setup()
    render(tabApp(true, '/other'))
    await user.click(screen.getByRole('link', { name: 'Tab' }))
    scrolledTo(900)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    await user.click(screen.getByRole('link', { name: 'Tab' }))
    scrolledTo(200)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(tabPlace('/')?.y).toBe(200)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 900)
  })

  it('keeps where the tab was left while the screen hasn’t come back to it yet', async () => {
    const user = userEvent.setup()
    saveTabPlace('/', { search: '?q=dune', y: 640 })
    render(tabApp(false, '/other'))
    await user.click(screen.getByRole('link', { name: 'Tab' }))
    // Left while still loading, from the clamped position the browser left it at.
    scrolledTo(80)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(tabPlace('/')).toEqual({ search: '?q=dune', y: 640 })
  })
})

describe('useScrollRestoration when the page is hidden', () => {
  it('saves nothing for a screen that’s gone', async () => {
    const user = userEvent.setup()
    render(app(true))
    scrolledTo(640)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    // Another screen, scrolled elsewhere, when the page is hidden or goes away.
    scrolledTo(50)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
  })
})

describe('useScrollRestoration across a reload', () => {
  /** The tab's screen on an entry its link opened, as a reload finds it again: the same key and state. */
  const tabEntry = (ready = true) => (
    <MemoryRouter initialEntries={[{ pathname: '/', state: TAB_RETURN, key: 'tab-entry' }]}>
      <Routes>
        <Route path="/" element={<TabScreen ready={ready} />} />
      </Routes>
    </MemoryRouter>
  )

  it.each([
    ['the page is hidden', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    }],
    ['the page goes away', () => window.dispatchEvent(new Event('pagehide'))],
  ])('brings an entry the tab’s link opened back to where it was when %s, not to where the tab was left', (_, leave) => {
    saveTabPlace('/', { search: '', y: 1200 })
    render(tabEntry())
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1200)
    scrolledTo(2500)
    leave()
    // A reload runs no cleanup: the old page stays as it was, and a new one starts.
    render(tabEntry())
    expect(scrollTo).toHaveBeenLastCalledWith(0, 2500)
  })

  it('doesn’t save a position over the one it hasn’t brought back yet', () => {
    sessionStorage.setItem('kinoseed.scroll:tab-entry', '2500')
    render(tabEntry(false))
    scrolledTo(80)
    window.dispatchEvent(new Event('pagehide'))
    render(tabEntry())
    expect(scrollTo).toHaveBeenLastCalledWith(0, 2500)
  })
})

describe('useScrollRestoration on a document’s first entry', () => {
  /** How the browser says the document was loaded: typed or followed, reloaded, or Back into it. */
  function loadedBy(type: NavigationTimingType) {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((entryType) =>
      entryType === 'navigation' ? [{ type } as PerformanceNavigationTiming] : [],
    )
  }

  /** The screen in a new document: the hook's module loaded again, as a page load does. */
  async function renderInNewDocument() {
    vi.resetModules()
    const { useScrollRestoration: restore } = await import('./useScrollRestoration')
    function FirstScreen() {
      restore(true, '/')
      return <Link to="/other">Open</Link>
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<FirstScreen />} />
          <Route path="/other" element={<Other />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  afterEach(() => vi.restoreAllMocks())

  // React Router names every document's first entry "default", so an earlier document's position is kept under
  // the same name in the session's storage.
  beforeEach(() => sessionStorage.setItem('kinoseed.scroll:default', '900'))

  it('opens a document loaded afresh at the top, whatever an earlier one left under its first entry', async () => {
    loadedBy('navigate')
    await renderInNewDocument()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it.each(['reload', 'back_forward'] as const)('brings the first entry back on a %s', async (type) => {
    loadedBy(type)
    await renderInNewDocument()
    expect(scrollTo).toHaveBeenCalledWith(0, 900)
  })

  it('still brings the first entry back on Back within the document', async () => {
    const user = userEvent.setup()
    loadedBy('navigate')
    await renderInNewDocument()
    scrolledTo(300)
    await user.click(screen.getByRole('link', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 300)
  })
})

/** Screens by their path's first part: `/a/1` and `/a/2` are one screen, as a drawer over a page is. */
function Shell() {
  const { pathname } = useLocation()
  useNewScreenAtTop(pathname.split('/')[1])
  const navigate = useNavigate()
  return (
    <>
      <Link to="/a/2">Same screen</Link>
      <Link to="/b">Another screen</Link>
      <Link to="/c" state={TAB_RETURN}>
        A tab
      </Link>
      <Link to="/a/1" replace>
        Replace
      </Link>
      <button type="button" onClick={() => void navigate(-1)}>
        Back
      </button>
    </>
  )
}

describe('useNewScreenAtTop', () => {
  const shell = () =>
    render(
      <MemoryRouter initialEntries={['/a/1']}>
        <Shell />
      </MemoryRouter>,
    )

  it('opens another screen at the top on a forward navigation, a replace included', async () => {
    const user = userEvent.setup()
    shell()
    expect(scrollTo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('link', { name: 'Another screen' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    scrollTo.mockClear()
    await user.click(screen.getByRole('link', { name: 'Replace' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves the same screen, Back and a tab’s link to the screen', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getByRole('link', { name: 'Same screen' }))
    await user.click(screen.getByRole('link', { name: 'A tab' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
