/* oxlint-disable react/only-export-components -- test helpers, never hot-reloaded */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router'

/**
 * Renders `ui` under a MemoryRouter at the last of `entries` (strings, or locations with state), as
 * screens that read the URL or navigate need. A test that renders `<Routes>` puts them in `ui`.
 */
export function renderWithRouter(ui: ReactNode, entries: InitialEntry[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      {ui}
    </MemoryRouter>,
  )
}

/** Shows the current path, for a test that checks where a screen navigated; read it with `where()`. */
export function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>
}

export const where = () => screen.getByRole('status', { name: 'Location' }).textContent

/**
 * Picks a live region by what it says, for a screen where several share the role (a toast over a list
 * that is a status region itself): a status or alert takes no name from its text, so
 * `findByRole('status', { name: saying('Torrent deleted') })` matches it on its text instead.
 */
export const saying = (text: string) => (_name: string, element: Element) => element.textContent?.includes(text) ?? false
