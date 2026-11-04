import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from 'vitest'
import { forgetTabPlaces, saveTabPlace } from '../../lib/tabPlaces'
import { renderWithRouter } from '../../test/render'
import { TabBar, type TabBarItem } from './TabBar'

const items: TabBarItem[] = [
  { to: '/', icon: 'download', label: 'Downloads', also: ['/torrent/'] },
  { to: '/search', icon: 'search', label: 'Search' },
]

/** Where the app is, its state and its history entry, for what a tab's press did. */
function Location() {
  const { pathname, search, state, key } = useLocation()
  return <output aria-label="Location">{JSON.stringify({ path: pathname + search, state, key })}</output>
}

const location = () =>
  JSON.parse(screen.getByRole('status', { name: 'Location' }).textContent ?? '{}') as {
    path: string
    state: unknown
    key: string
  }

function renderTabs(path: string) {
  renderWithRouter(
    <>
      <Routes>
        <Route path="*" element={<Location />} />
      </Routes>
      <TabBar label="Main" items={items} />
    </>,
    [path],
  )
}

let scrollTo: MockInstance<typeof window.scrollTo>

beforeEach(() => {
  forgetTabPlaces()
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TabLink', () => {
  it('links to its tab with the query the tab was left with', () => {
    saveTabPlace('/search', { search: '?q=dune&type=tv', y: 640 })
    renderTabs('/')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search?q=dune&type=tv')
  })

  it('links to the query shown on its own screen, not the one it was left with before', () => {
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    renderTabs('/search?q=andor')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search?q=andor')
  })

  it('opens its tab saying it’s the tab’s link, so the screen comes back where the tab was left', async () => {
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    renderTabs('/')
    await userEvent.click(screen.getByRole('link', { name: 'Search' }))
    expect(location()).toMatchObject({ path: '/search?q=dune', state: { tabReturn: true } })
  })

  it('goes back to its tab’s screen from a screen inside it', async () => {
    renderTabs('/torrent/abc')
    await userEvent.click(screen.getByRole('link', { name: 'Downloads' }))
    expect(location()).toMatchObject({ path: '/', state: { tabReturn: true } })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls its own screen to the top, smoothly, and keeps the query', async () => {
    saveTabPlace('/search', { search: '?q=dune', y: 0 })
    renderTabs('/search?q=dune')
    const before = location()
    await userEvent.click(screen.getByRole('link', { name: 'Search' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    // Not opened again: the same history entry.
    expect(location()).toEqual(before)
  })

  it('jumps to the top for a user who asked for less motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    renderTabs('/search')
    await userEvent.click(screen.getByRole('link', { name: 'Search' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  it('leaves a click with a modifier to the browser', async () => {
    const user = userEvent.setup()
    // After the link's own handler: jsdom can't open the link in a new tab or window.
    const stay = (event: Event) => event.preventDefault()
    document.addEventListener('click', stay)
    onTestFinished(() => document.removeEventListener('click', stay))
    renderTabs('/search')
    const link = screen.getByRole('link', { name: 'Search' })
    for (const key of ['Control', 'Meta', 'Shift', 'Alt']) {
      await user.keyboard(`{${key}>}`)
      await user.click(link)
      await user.keyboard(`{/${key}}`)
      expect(scrollTo, key).not.toHaveBeenCalled()
    }
  })
})
