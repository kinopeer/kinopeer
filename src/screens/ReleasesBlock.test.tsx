import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SORT, NO_FILTERS, NO_REMEMBERED_FILTERS } from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { DUNE_RELEASES } from '../test/fixtures'
import { ReleasesBody, ReleasesCount } from './ReleasesBlock'
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
    cycleSort: vi.fn(),
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

  it('names the indexers that didn’t answer in a banner when nothing was found', () => {
    const { rerender } = renderBody(releases({ status: 'none', rows: [], visible: [] }))
    // The live region is there, empty, before the names come.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    rerender(
      <ReleasesBody releases={releases({ status: 'none', rows: [], visible: [], failing: ['Indexer C', 'Indexer D'] })} skeleton={<p>Skeleton</p>}>
        <p>The list</p>
      </ReleasesBody>,
    )
    expect(screen.getByRole('status', { name: saying('2 indexers didn’t answer: Indexer C, Indexer D') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
  })

  it('leaves the failed indexers to the count’s line while there are results', () => {
    renderBody(releases({ failing: ['Indexer C'] }))
    expect(screen.getByText('The list')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Indexer C/)).not.toBeInTheDocument()
  })

  it('names the failed indexers in a banner when the filters hide every release and the count’s line is in the list', () => {
    const hidden = releases({ visible: [], failing: ['Indexer C'] })
    const { unmount } = render(
      <ReleasesBody releases={hidden} skeleton={<p>Skeleton</p>} countInList>
        <p>The list</p>
      </ReleasesBody>,
    )
    expect(screen.getByRole('status', { name: saying('1 indexer didn’t answer: Indexer C') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    unmount()

    // Desktop's count is in the section's heading, there whatever the filters show.
    renderBody(hidden)
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('ReleasesCount', () => {
  it('says how many releases the filters show of how many were found', () => {
    render(<ReleasesCount releases={releases({ visible: ROWS.slice(0, 2) })} />)
    expect(screen.getByText('2 of 3 releases')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says how many indexers didn’t answer in the same line, and names them on a tap', async () => {
    const { rerender } = render(<ReleasesCount releases={releases()} />)
    const line = screen.getByText('3 of 3 releases')
    rerender(<ReleasesCount releases={releases({ failing: ['Indexer C', 'Indexer D'] })} />)
    // In the live region the count is in, so a screen reader announces it as it comes.
    expect(line).toHaveAttribute('aria-live', 'polite')
    expect(line).toHaveTextContent('3 of 3 releases · 2 indexers didn’t answer')
    const button = within(line).getByRole('button', { name: '2 indexers didn’t answer', expanded: false })
    expect(screen.queryByText('Indexer C, Indexer D')).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const names = screen.getByText('Indexer C, Indexer D')
    expect(button).toHaveAttribute('aria-controls', names.id)

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Indexer C, Indexer D')).not.toBeInTheDocument()
  })

  it('drops the names when a search again finds every indexer answering', async () => {
    const { rerender } = render(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    await userEvent.click(screen.getByRole('button', { name: '1 indexer didn’t answer' }))
    expect(screen.getByText('Indexer C')).toBeInTheDocument()
    rerender(<ReleasesCount releases={releases()} />)
    // Nothing under the count: not even an empty line.
    expect(screen.getByText('3 of 3 releases').nextElementSibling).toBeNull()
  })

  it('says one indexer in the singular', () => {
    render(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    expect(screen.getByRole('button', { name: '1 indexer didn’t answer' })).toBeInTheDocument()
  })
})
