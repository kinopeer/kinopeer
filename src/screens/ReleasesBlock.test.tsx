import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SORT, NO_FILTERS, NO_REMEMBERED_FILTERS } from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { DUNE_RELEASES } from '../test/fixtures'
import { ReleasesBody } from './ReleasesBlock'
import type { Releases } from './useReleases'
import { saying } from '../test/render'

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
    aside: NO_REMEMBERED_FILTERS,
    forgetAside: vi.fn(),
    sort: DEFAULT_SORT,
    pickSort: vi.fn(),
    clickSort: vi.fn(),
    reverseSort: vi.fn(),
    resolutionLabel: (value) => value,
    audioLabel: (value) => value,
    sourceLabel: (value) => value,
    optionLabel: (label) => label,
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
    expect(screen.getByRole('heading', { name: 'Prowlarr isn’t answering' })).toBeInTheDocument()
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
    expect(search.clearFilters).toHaveBeenCalled()
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
    expect(search.clearFilters).toHaveBeenCalled()
  })

  it('names the remembered filters the search sets aside, and forgets them on Forget', async () => {
    const search = releases({
      aside: { resolution: ['2160p', 'none'], audio: ['dub'], source: ['none'], minSeeds: 100 },
      resolutionLabel: (value) => (value === 'none' ? 'Resolution not stated' : value),
      audioLabel: () => 'Dubbed',
      sourceLabel: () => 'Source not stated',
    })
    renderBody(search)
    expect(
      screen.getByText('Remembered filters not applied: 2160p, Resolution not stated, Dubbed, Source not stated, and 100+ seeds'),
    ).toBeInTheDocument()
    expect(screen.getByText('The list')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
    expect(search.forgetAside).toHaveBeenCalled()
  })

  it('shows no filter row without picked filters', () => {
    renderBody(releases())
    expect(screen.getByText('The list')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names the indexers that didn’t answer, also when nothing was found', () => {
    const { rerender, unmount } = renderBody(releases())
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    rerender(
      <ReleasesBody releases={releases({ failing: ['Indexer C'] })} skeleton={<p>Skeleton</p>}>
        <p>The list</p>
      </ReleasesBody>,
    )
    expect(screen.getByRole('status', { name: saying('1 indexer didn’t answer: Indexer C') })).toBeInTheDocument()
    expect(screen.getByText('The list')).toBeInTheDocument()
    unmount()

    renderBody(releases({ status: 'none', rows: [], visible: [], failing: ['Indexer C', 'Indexer D'] }))
    expect(screen.getByRole('status', { name: saying('2 indexers didn’t answer: Indexer C, Indexer D') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
  })
})
