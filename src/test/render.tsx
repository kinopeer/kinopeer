import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'

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
