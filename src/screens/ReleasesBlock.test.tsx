import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as settings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { ToastProvider } from '../components/Toast'
import { DEFAULT_SORT, NO_FILTERS, NO_REMEMBERED_FILTERS } from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { DUNE_RELEASES } from '../test/fixtures'
import { ReleasesBody, ReleasesCount } from './ReleasesBlock'
import type { Releases } from './useReleases'
import { saying } from '../test/render'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof settings>()),
  getServerSettings: vi.fn(),
  saveProwlarrKey: vi.fn(),
}))

/** The server's settings with Prowlarr's address from `address`, its key as given, and Kinopeer's own login on or off. */
function serverSettings(
  address: ServerSettings['prowlarr']['address'],
  { key = false, login = true }: { key?: boolean; login?: boolean } = {},
): ServerSettings {
  return {
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: key, source: key ? 'saved' : null, serverKey: false, address },
    qbittorrent: { configured: true, source: 'saved', address: { source: 'env' } },
    downloads: null,
    auth: login ? { enabled: true, source: 'saved' } : { enabled: false },
  }
}

beforeEach(() => {
  vi.mocked(settings.getServerSettings).mockReset()
  vi.mocked(settings.saveProwlarrKey).mockReset()
})

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
    inDownloads: () => undefined,
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
    { wrapper: ToastProvider },
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

  it('sets Prowlarr up from the releases screen where the app can, then searches again (#510)', async () => {
    vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: null }))
    const saved = serverSettings({ source: 'saved', url: 'http://prowlarr:9696' }, { key: true })
    vi.mocked(settings.saveProwlarrKey).mockResolvedValue(saved)
    const search = releases({ status: 'setup', rows: [], visible: [] })
    renderBody(search)
    expect(screen.getByRole('heading', { name: 'Prowlarr isn’t set up' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Prowlarr' }))
    expect(screen.queryByText(/PROWLARR_URL/)).not.toBeInTheDocument()

    const sheet = screen.getByRole('dialog', { name: 'Prowlarr connection' })
    await userEvent.type(within(sheet).getByLabelText('Prowlarr address'), 'http://prowlarr:9696')
    await userEvent.type(within(sheet).getByLabelText('Prowlarr API key'), 'abc123')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(settings.saveProwlarrKey).toHaveBeenCalledWith('abc123', 'http://prowlarr:9696')
    expect(await screen.findByText('Prowlarr address and key saved')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(search.retry).toHaveBeenCalledOnce()
  })

  it('asks only for the key where the server has Prowlarr’s address', async () => {
    vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'env' }))
    renderBody(releases({ status: 'setup', rows: [], visible: [] }))
    expect(await screen.findByText('Kinopeer finds releases through Prowlarr. Enter its API key, and the search runs again.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set up Prowlarr' }))
    const sheet = screen.getByRole('dialog', { name: 'Prowlarr key' })
    expect(within(sheet).queryByLabelText('Prowlarr address')).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText('Prowlarr API key')).toBeInTheDocument()
  })

  it('says Prowlarr’s address is the server’s to set, with nothing to press, where Kinopeer’s own login is off', async () => {
    vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: null }, { login: false }))
    renderBody(releases({ status: 'setup', rows: [], visible: [] }))
    expect(
      await screen.findByText('Kinopeer’s own login is off, so Prowlarr’s address can only be set on the server: PROWLARR_URL.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says Prowlarr rejected the key and changes it, with the saved address, then searches again', async () => {
    vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'saved', url: 'http://prowlarr:9696' }, { key: true }))
    vi.mocked(settings.saveProwlarrKey).mockResolvedValue(serverSettings({ source: 'saved', url: 'http://prowlarr:9696' }, { key: true }))
    const search = releases({ status: 'rejected', rows: [], visible: [] })
    renderBody(search)
    expect(screen.getByRole('heading', { name: 'Prowlarr didn’t accept the API key' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Change Prowlarr address and key' }))
    const sheet = screen.getByRole('dialog', { name: 'Prowlarr connection' })
    expect(within(sheet).getByLabelText('Prowlarr address')).toHaveValue('http://prowlarr:9696')
    await userEvent.type(within(sheet).getByLabelText('Prowlarr API key'), 'new-key')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(settings.saveProwlarrKey).toHaveBeenCalledWith('new-key', 'http://prowlarr:9696')
    expect(await screen.findByText('Prowlarr address and key saved')).toBeInTheDocument()
    expect(search.retry).toHaveBeenCalledOnce()
  })

  it('still offers the key where the server’s settings don’t load', async () => {
    vi.mocked(settings.getServerSettings).mockRejectedValue(new Error('down'))
    renderBody(releases({ status: 'setup', rows: [], visible: [] }))
    await userEvent.click(await screen.findByRole('button', { name: 'Set up Prowlarr' }))
    expect(screen.getByRole('dialog', { name: 'Prowlarr key' })).toBeInTheDocument()
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
    // Collapsed, it names no element: the names aren't in the document.
    expect(button).not.toHaveAttribute('aria-controls')

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const names = screen.getByText('Indexer C, Indexer D')
    expect(button).toHaveAttribute('aria-controls', names.id)

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Indexer C, Indexer D')).not.toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-controls')
  })

  it('drops the names when a search again finds every indexer answering', async () => {
    const { rerender } = render(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    const button = screen.getByRole('button', { name: '1 indexer didn’t answer' })
    await userEvent.click(button)
    const id = button.getAttribute('aria-controls')!
    expect(document.getElementById(id)).toHaveTextContent('Indexer C')
    rerender(<ReleasesCount releases={releases()} />)
    // Nothing under the count: not even an empty line.
    expect(document.getElementById(id)).toBeNull()
  })

  it('starts a new search’s failed indexers closed, though the names were open for the last one', async () => {
    const { rerender } = render(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    await userEvent.click(screen.getByRole('button', { name: '1 indexer didn’t answer' }))
    expect(screen.getByText('Indexer C')).toBeInTheDocument()
    rerender(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    expect(screen.getByRole('button', { name: '1 indexer didn’t answer', expanded: false })).toBeInTheDocument()
    expect(screen.queryByText('Indexer C')).not.toBeInTheDocument()
  })

  it('says one indexer in the singular', () => {
    render(<ReleasesCount releases={releases({ failing: ['Indexer C'] })} />)
    expect(screen.getByRole('button', { name: '1 indexer didn’t answer' })).toBeInTheDocument()
  })
})
