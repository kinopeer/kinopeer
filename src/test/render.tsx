/* oxlint-disable react/only-export-components -- test helpers, never hot-reloaded */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router'
import { ToastProvider } from '../components/Toast'

/**
 * Renders `ui` under a MemoryRouter at the last of `entries` (strings, or locations with state) and
 * a `ToastProvider`, as screens that read the URL, navigate or show toasts need. A test that renders
 * `<Routes>` puts them in `ui`.
 */
export function renderWithRouter(ui: ReactNode, entries: InitialEntry[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  )
}

/** Shows the current path, for a test that checks where a screen navigated; read it with `where()`. */
export function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>
}

export const where = () => screen.getByRole('status', { name: 'Location' }).textContent

const normalized = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * Picks a live region (a toast, an error banner) by what it says, as the `name` in
 * `findByRole('status', { name: saying('Torrent deleted') })`: a status or alert takes no name from its
 * text. Like `getByText`, a string matches a whole text, the region's or one of its elements' (a
 * banner's title or body), so "12 torrents deleted" isn't "2 torrents deleted"; a RegExp is for a
 * part of a longer message. It waits for that text even while other regions with the role are up.
 */
export function saying(text: string | RegExp) {
  const says = (node: Element) =>
    typeof text === 'string' ? normalized(node.textContent) === text : text.test(normalized(node.textContent))
  const matcher = (_name: string, element: Element) => [element, ...element.querySelectorAll('*')].some(says)
  // What a failed query prints in place of the function's source.
  matcher.toString = () => `saying(${String(text)})`
  return matcher
}
