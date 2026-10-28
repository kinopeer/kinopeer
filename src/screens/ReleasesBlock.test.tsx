import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SORT, NO_FILTERS } from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { DUNE_RELEASES } from '../test/fixtures'
import { ReleasesBody } from './ReleasesBlock'
import type { Releases } from './useReleases'

const ROWS = DUNE_RELEASES.map((release) => ({ release, info: parseRelease(release.title) }))

/** A search in the given state; the callbacks are spies. */
function releases(fields: Partial<Releases> = {}): Releases {
  return {
    status: 'ready',
    retry: vi.fn(),
    failing: [],
    rows: ROWS,
    visible: ROWS,
    present: { resolution: [], audio: [], source: [], indexer: [] },
    filters: NO_FILTERS,
    updateFilters: vi.fn(),
    clearFilters: vi.fn(),
    active: [],
    sort: DEFAULT_SORT,
    setSort: vi.fn(),
    audioLabel: (value) => value,
    adding: undefined,
    setAdding: vi.fn(),
    ...fields,
  }
}

function renderBody(search: Releases) {
  return render(
    <ReleasesBody releases={search} skeleton={<p>Skeleton</p>}>
      <p>The list</p>
    </ReleasesBody>,
  )
}

describe('ReleasesBody', () => {
  it('shows the skeleton in a live region while the search runs', () => {
    renderBody(releases({ status: 'loading', rows: [], visible: [] }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Searching releases')
    expect(within(status).getByText('Skeleton')).toBeInTheDocument()
    expect(screen.queryByText('The list')).not.toBeInTheDocument()
  })

  it('explains a missing Prowlarr setup, with nothing to retry', () => {
    renderBody(releases({ status: 'setup', rows: [], visible: [] }))
    expect(screen.getByRole('heading', { name: 'Prowlarr isn’t connected' })).toBeInTheDocument()
    expect(screen.getByText(/PROWLARR_URL/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says when Prowlarr can’t be reached and searches again on Try again', async () => {
    const search = releases({ status: 'error', rows: [], visible: [] })
    renderBody(search)
    expect(screen.getByRole('heading', { name: 'Couldn’t reach Prowlarr' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(search.retry).toHaveBeenCalledOnce()
  })

  it('says when nothing was found and searches again on Try again', async () => {
    const search = releases({ status: 'none', rows: [], visible: [] })
    renderBody(search)
    expect(screen.getByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(search.retry).toHaveBeenCalledOnce()
  })

  it('says when the filters hide every release and resets them', async () => {
    const search = releases({ visible: [], filters: { ...NO_FILTERS, resolution: ['720p'] }, active: [{ key: 'r-720p', label: '720p', remove: { resolution: [] } }] })
    renderBody(search)
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    expect(screen.queryByText('The list')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(search.clearFilters).toHaveBeenCalledOnce()
  })

  it('lists the releases with the picked filters above them, each removable, and Clear all', async () => {
    const search = releases({
      active: [
        { key: 'r-2160p', label: '2160p', remove: { resolution: [] } },
        { key: 'seeds', label: '100+ seeds', remove: { minSeeds: 0 } },
      ],
    })
    renderBody(search)
    expect(screen.getByText('The list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter 100+ seeds' })).toHaveTextContent('100+ seeds')
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(search.updateFilters).toHaveBeenCalledWith({ resolution: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(search.clearFilters).toHaveBeenCalledOnce()
  })

  it('shows no filter row without picked filters', () => {
    renderBody(releases())
    expect(screen.getByText('The list')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the indexers that didn’t answer, also when nothing was found', () => {
    const { unmount } = renderBody(releases({ failing: ['Kinozal'] }))
    expect(screen.getByRole('status')).toHaveTextContent('1 indexer didn’t answer: Kinozal')
    expect(screen.getByText('The list')).toBeInTheDocument()
    unmount()

    renderBody(releases({ status: 'none', rows: [], visible: [], failing: ['Kinozal', 'RuTracker'] }))
    expect(screen.getByRole('status')).toHaveTextContent('2 indexers didn’t answer: Kinozal, RuTracker')
    expect(screen.getByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
  })
})
