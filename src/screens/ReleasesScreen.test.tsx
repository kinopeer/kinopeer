import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import i18n from '../i18n'
import { resetSettings, updateSettings } from '../settings/settings'
import { counted, labelOf } from '../test/filterChips'
import { DUNE_RELEASES, duneTorrent, release, torrent } from '../test/fixtures'
import { Opened, opened, renderWithRouter, saying } from '../test/render'
import { resetOneOffTorrents } from '../torrents/oneOffTorrents'
import { ReleasesScreen } from './ReleasesScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn() }
})
vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), getFailingIndexers: vi.fn(), fetchRelease: vi.fn() }
})
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  addTorrents: vi.fn(),
  getCategories: vi.fn(),
  getDefaultSavePath: vi.fn(),
  getMainData: vi.fn(),
  getTorrents: vi.fn(),
}))

const getMovie = vi.mocked(tmdb.getMovie)
const getTv = vi.mocked(tmdb.getTv)
const searchReleases = vi.mocked(prowlarr.searchReleases)

const DUNE = { id: 693134, title: 'Dune: Part Two', original_title: 'Dune: Part Two', release_date: '2024-02-27' } as MovieDetails
const BB = { id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20' } as TvDetails

function SettingsPage() {
  return <h1>Settings page {JSON.stringify(useLocation().state)}</h1>
}

function renderAt(path: string) {
  return renderWithRouter(
    <Routes>
      <Route path="/title/:type/:id/releases" element={<ReleasesScreen />} />
      <Route path="/title/:type/:id" element={<h1>Title page</h1>} />
      <Route path="/" element={<h1>Downloads</h1>} />
      <Route path="/torrent/:hash" element={<Opened />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>,
    [path],
  )
}

// The name is the card's button that opens and closes it on a phone (ReleaseName).
const names = () => screen.getAllByRole('article').map((card) => within(card).getByRole('button', { expanded: false }).textContent)

beforeEach(() => {
  // Filters and the sort are remembered in the browser between searches.
  resetSettings()
  vi.resetAllMocks()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(BB)
  searchReleases.mockResolvedValue(DUNE_RELEASES)
  vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue([])
  resetOneOffTorrents()
  vi.mocked(qbt.getTorrents).mockResolvedValue([])
})

/** Shows the address's query, for the tests of the edited query; read it with `address()`. */
function Address() {
  return <output aria-label="Address">{useLocation().search}</output>
}

const address = () => screen.getByRole('status', { name: 'Address' }).textContent

/** The releases with the address shown, the title page before them in the history unless `opened`. */
function renderQueryAt(path: string, { opened = false } = {}) {
  return renderWithRouter(
    <Routes>
      <Route
        path="/title/:type/:id/releases"
        element={
          <>
            <ReleasesScreen />
            <Address />
          </>
        }
      />
      <Route path="/title/:type/:id" element={<h1>Title page</h1>} />
    </Routes>,
    opened ? [path] : ['/title/movie/693134', path],
  )
}

describe('ReleasesScreen, the search query (#582)', () => {
  const field = () => screen.getByRole('searchbox', { name: 'Search query' })

  it('searches by the query edited, keeps it in the address, and Reset brings the built one back', async () => {
    renderQueryAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    expect(field()).toHaveValue('Dune Part Two 2024')
    expect(screen.queryByRole('button', { name: 'Reset query' })).not.toBeInTheDocument()

    searchReleases.mockResolvedValue([DUNE_RELEASES[0]])
    await userEvent.clear(field())
    await userEvent.type(field(), 'Dune 2 2024')
    // Typing searches nothing: a search asks every indexer.
    expect(searchReleases).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('1 of 1 release')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenLastCalledWith('Dune 2 2024', expect.anything())
    expect(address()).toBe('?q=Dune+2+2024')

    searchReleases.mockResolvedValue(DUNE_RELEASES)
    await userEvent.click(screen.getByRole('button', { name: 'Reset query' }))
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenLastCalledWith('Dune Part Two 2024', expect.anything())
    expect(field()).toHaveValue('Dune Part Two 2024')
    expect(address()).toBe('')
    expect(screen.queryByRole('button', { name: 'Reset query' })).not.toBeInTheDocument()
  })

  it('shows the field, off and empty, until the title’s details come', async () => {
    let answer: (details: MovieDetails) => void = () => {}
    getMovie.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderQueryAt('/title/movie/693134/releases')
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('')
    act(() => answer(DUNE))
    await screen.findByText('3 of 3 releases')
    expect(field()).toBeEnabled()
    expect(field()).toHaveValue('Dune Part Two 2024')
  })

  it('keeps Reset off with the field, before the title’s details come', async () => {
    let answer: (details: MovieDetails) => void = () => {}
    getMovie.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderQueryAt('/title/movie/693134/releases?q=Dune%202')
    expect(field()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset query' })).toBeDisabled()
    act(() => answer(DUNE))
    await screen.findByText('3 of 3 releases')
    expect(screen.getByRole('button', { name: 'Reset query' })).toBeEnabled()
  })

  it('shows no field for a title that isn’t found', async () => {
    getMovie.mockRejectedValue(new tmdb.TmdbError('TMDB responded 404', 404))
    renderQueryAt('/title/movie/1/releases')
    expect(await screen.findByRole('heading', { name: 'Title not found' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search query' })).not.toBeInTheDocument()
  })

  it('shows no field for a link that names no title', () => {
    renderQueryAt('/title/person/abc/releases')
    expect(screen.getByRole('heading', { name: 'Title not found' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search query' })).not.toBeInTheDocument()
  })

  it('searches the query already searched again on Enter, once its search has settled', async () => {
    searchReleases.mockRejectedValueOnce(new prowlarr.ProwlarrError('Prowlarr responded 500', 500))
    renderQueryAt('/title/movie/693134/releases?q=Dune%202')
    await waitFor(() => expect(searchReleases).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: 'Try again' })
    await userEvent.type(field(), '{Enter}')
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledTimes(2)
    expect(searchReleases).toHaveBeenLastCalledWith('Dune 2', expect.anything())
    // The address is left as it was.
    expect(address()).toBe('?q=Dune%202')
  })

  it('sends no second search for the query while its search is on its way', async () => {
    searchReleases.mockReturnValue(new Promise(() => {}))
    renderQueryAt('/title/movie/693134/releases?q=Dune%202')
    await waitFor(() => expect(searchReleases).toHaveBeenCalledTimes(1))
    await userEvent.type(field(), '{Enter}')
    expect(searchReleases).toHaveBeenCalledTimes(1)
  })

  it('searches by the query in the address, as after a reload', async () => {
    renderQueryAt('/title/movie/693134/releases?q=Dune%202')
    await screen.findByText('3 of 3 releases')
    expect(searchReleases).toHaveBeenCalledTimes(1)
    expect(searchReleases).toHaveBeenCalledWith('Dune 2', expect.anything())
    expect(field()).toHaveValue('Dune 2')
    expect(screen.getByRole('button', { name: 'Reset query' })).toBeInTheDocument()

    // An emptied query goes back to the built one, as Reset does.
    await userEvent.clear(field())
    await userEvent.type(field(), '{Enter}')
    await waitFor(() => expect(address()).toBe(''))
    expect(field()).toHaveValue('Dune Part Two 2024')
    await waitFor(() => expect(searchReleases).toHaveBeenLastCalledWith('Dune Part Two 2024', expect.anything()))
  })

  it('goes back to the built query on an empty one or the built one, searching it again', async () => {
    renderQueryAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    // The built query with spaces after it is the built query.
    await userEvent.type(field(), '  {Enter}')
    expect(address()).toBe('')
    await userEvent.clear(field())
    await userEvent.type(field(), '  {Enter}')
    expect(address()).toBe('')
    expect(field()).toHaveValue('Dune Part Two 2024')
    await userEvent.clear(field())
    await userEvent.type(field(), '{Enter}')
    expect(address()).toBe('')
    expect(field()).toHaveValue('Dune Part Two 2024')
    // Each Enter searched the built query again, never another one.
    await waitFor(() => expect(searchReleases).toHaveBeenCalledTimes(4))
    expect(new Set(searchReleases.mock.calls.map(([query]) => query))).toEqual(new Set(['Dune Part Two 2024']))
  })

  it('submits without the browser sending the form', async () => {
    renderQueryAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    const submit = createEvent.submit(screen.getByRole('search'))
    fireEvent(screen.getByRole('search'), submit)
    expect(submit.defaultPrevented).toBe(true)
  })

  it('replaces the address’s entry, so Back leaves the releases', async () => {
    renderQueryAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    await userEvent.clear(field())
    await userEvent.type(field(), 'Dune 2{Enter}')
    await waitFor(() => expect(address()).toBe('?q=Dune+2'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Title page' })).toBeInTheDocument()
  })
  it('still goes back to the title from releases opened from a link, after the query was edited', async () => {
    renderQueryAt('/title/movie/693134/releases', { opened: true })
    await screen.findByText('3 of 3 releases')
    await userEvent.clear(field())
    await userEvent.type(field(), 'Dune 2{Enter}')
    await waitFor(() => expect(address()).toBe('?q=Dune+2'))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Title page' })).toBeInTheDocument()
  })
})

describe('ReleasesScreen', () => {
  it('searches by original title and year and lists releases by seeders', async () => {
    renderAt('/title/movie/693134/releases')
    expect(screen.getByRole('status', { name: saying('Searching releases') })).toBeInTheDocument()

    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Dune Part Two 2024', expect.not.objectContaining({ categories: expect.anything() }))
    expect(screen.getByText('Dune: Part Two · 2024')).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[1].title, DUNE_RELEASES[0].title, DUNE_RELEASES[2].title])

    const [top] = screen.getAllByRole('article')
    expect(within(top).getByText('Dubbed')).toBeInTheDocument()
    expect(within(top).getByText('9.40 GB')).toBeInTheDocument()
    expect(within(top).getByLabelText('2451 seeders')).toBeInTheDocument()
  })

  // The walk through the sorts is useReleases' test's; this is the chip's wiring to it.
  it('turns the sort the other way from its chip, then goes on to the next sort', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Sort: Seeds, Descending' }))
    expect(screen.getByRole('button', { name: 'Sort: Seeds, Ascending' })).toHaveTextContent('Seeds ↑')
    expect(names()).toEqual([DUNE_RELEASES[2].title, DUNE_RELEASES[0].title, DUNE_RELEASES[1].title])
    // The second press tells the walk from the direction button's plain reverse.
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Seeds, Ascending' }))
    expect(screen.getByRole('button', { name: 'Sort: Size, Descending' })).toBeInTheDocument()
  })

  it('picks the sort and its direction in the sheet', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    expect(sheet.getByRole('radio', { name: 'Seeds', checked: true })).toBeInTheDocument()
    await userEvent.click(sheet.getByRole('radio', { name: 'Size' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Descending' }))
    expect(sheet.getByRole('button', { name: 'Ascending' })).toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: 'Show 3' }))
    expect(screen.getByRole('button', { name: 'Sort: Size, Ascending' })).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[2].title, DUNE_RELEASES[1].title, DUNE_RELEASES[0].title])
  })

  it('filters by indexer when the results come from more than one', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    const indexers = within(sheet.getByRole('group', { name: 'Indexer' }))
    expect(indexers.getAllByRole('button').map(labelOf)).toEqual(['Indexer C', 'Indexer D'])
    await userEvent.click(indexers.getByRole('button', { name: counted('Indexer D') }))
    await userEvent.click(sheet.getByRole('button', { name: 'Show 1' }))
    expect(names()).toEqual([DUNE_RELEASES[0].title])
    expect(screen.getByRole('button', { name: 'Remove filter Indexer D' })).toBeInTheDocument()
  })

  it('shows how many releases each value would leave, a value that would leave none dimmed (#583)', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    const chips = (name: string) => within(sheet.getByRole('group', { name })).getAllByRole('button')
    expect(chips('Min seeds').map((chip) => chip.textContent)).toEqual(['Any 3', '10+ 3', '50+ 2', '100+ 2'])
    expect(chips('Audio').map((chip) => chip.textContent)).toEqual(['Dubbed 1', 'Not stated 2'])
    expect(chips('Indexer').map((chip) => chip.textContent)).toEqual(['Indexer C 2', 'Indexer D 1'])
    expect(chips('Source').map((chip) => chip.textContent)).toEqual(['REMUX 1', 'BluRay 1', 'WEB-DL 1'])
    await userEvent.click(sheet.getByRole('button', { name: counted('100+') }))
    expect(sheet.getByRole('button', { name: '100+ 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(sheet.getByRole('button', { name: 'Any 3' })).toHaveAttribute('aria-pressed', 'false')
    // The 720p release has 12 seeds.
    expect(chips('Resolution').map((chip) => chip.textContent)).toEqual(['2160p 1', '1080p 1', '720p 0'])
    // is-dim is what dims the chip; no role or attribute says it.
    expect(sheet.getByRole('button', { name: '720p 0' })).toHaveClass('is-dim')
    expect(sheet.getByRole('button', { name: '1080p 1' })).not.toHaveClass('is-dim')
    // Still a choice: it leaves nothing, as it says.
    await userEvent.click(sheet.getByRole('button', { name: '720p 0' }))
    expect(sheet.getByRole('button', { name: 'Show 0' })).toBeInTheDocument()
    expect(chips('Min seeds').map((chip) => chip.textContent)).toEqual(['Any 1', '10+ 1', '50+ 0', '100+ 0'])
    // is-dim is what dims the chip; no role or attribute says it.
    expect(sheet.getByRole('button', { name: '50+ 0' })).toHaveClass('is-dim')
    expect(sheet.getByRole('button', { name: '10+ 1' })).not.toHaveClass('is-dim')
  })

  it('opens the filters from each chip over the list, and presses the chips of what’s picked', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    const close = () => userEvent.click(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('button', { name: /^Show / }))
    for (const name of ['Filters', 'Resolution', 'Audio', 'Source']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(screen.getByRole('button', { name }))
      expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
      await close()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    await userEvent.click(within(sheet.getByRole('group', { name: 'Resolution' })).getByRole('button', { name: counted('1080p') }))
    await userEvent.click(within(sheet.getByRole('group', { name: 'Audio' })).getByRole('button', { name: counted('Not stated') }))
    await userEvent.click(within(sheet.getByRole('group', { name: 'Source' })).getByRole('button', { name: counted('BluRay') }))
    await close()
    expect(screen.getByRole('button', { name: 'Filters 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Audio not stated' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'BluRay' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('filters in the sheet and removes filters from the list', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    // Only values the results have are offered.
    const resolution = within(sheet).getByRole('group', { name: 'Resolution' })
    expect(within(resolution).getAllByRole('button').map(labelOf)).toEqual(['2160p', '1080p', '720p'])
    await userEvent.click(within(resolution).getByRole('button', { name: counted('2160p') }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show 1' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 releases')).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[0].title])
    expect(screen.getByRole('button', { name: 'Filters 1' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
  })

  it('names a theater rip in the interface language, on its card and in the source filter', async () => {
    await i18n.changeLanguage('ru')
    const cam = release('d', 'Dune.Part.Two.2024.HDTS.x264-GRPA', 1.5e9, 5)
    searchReleases.mockResolvedValue([...DUNE_RELEASES, cam])
    renderAt('/title/movie/693134/releases')
    const card = (await screen.findAllByRole('article')).find((article) => article.textContent?.includes(cam.title))!
    expect(within(card).getByText('Экранка')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Фильтры' }))
    const sheet = screen.getByRole('dialog', { name: 'Фильтры' })
    const source = within(within(sheet).getByRole('group', { name: 'Источник' }))
    await userEvent.click(source.getByRole('button', { name: counted('Экранка') }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Показать 1' }))
    expect(screen.getByRole('button', { name: 'Убрать фильтр Экранка' })).toBeInTheDocument()
  })

  it('offers Not stated for releases whose name states no resolution, source or audio', async () => {
    const bare = release('d', 'Дюна 2 / Dune: Part Two (2024)', 3e9, 50)
    searchReleases.mockResolvedValue([...DUNE_RELEASES, bare])
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    const group = (name: string) => within(within(sheet).getByRole('group', { name }))
    const options = (name: string) => group(name).getAllByRole('button').map(labelOf)
    // Under the filter's name the option says just Not stated; chips outside the group name the filter.
    expect(options('Resolution')).toEqual(['2160p', '1080p', '720p', 'Not stated'])
    expect(options('Source')).toEqual(['REMUX', 'BluRay', 'WEB-DL', 'Not stated'])
    // The remux and the 720p rip name no voice-over either.
    expect(options('Audio')).toEqual(['Dubbed', 'Not stated'])

    await userEvent.click(group('Resolution').getByRole('button', { name: counted('Not stated') }))
    await userEvent.click(within(sheet).getByRole('button', { name: counted('1080p') }))
    await userEvent.click(group('Source').getByRole('button', { name: counted('Not stated') }))
    await userEvent.click(group('Audio').getByRole('button', { name: counted('Not stated') }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show 1' }))
    expect(names()).toEqual([bare.title])
    expect(screen.getByRole('button', { name: 'Source not stated' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Audio not stated' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Resolution not stated +1' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Audio not stated' }))
    expect(names()).toEqual([bare.title])

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Source not stated' }))
    expect(screen.getByText('2 of 4 releases')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Resolution not stated' }))
    expect(names()).toEqual([DUNE_RELEASES[1].title])
  })

  it('says when filters hide everything', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('100+') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Filters 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('Dubbed') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('720p') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 0' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
  })

  // The count's line is in the list, which isn't shown then: the banner says it instead (countInList).
  it('names the indexers that didn’t answer above "Nothing matches"', async () => {
    vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue(['Indexer B'])
    renderAt('/title/movie/693134/releases')
    await screen.findByRole('button', { name: '1 indexer didn’t answer' })
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('100+') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Filters 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('Dubbed') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: counted('720p') }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 0' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: saying('1 indexer didn’t answer: Indexer B') })).toBeInTheDocument()
  })

  it('lists every release found, whatever its category', async () => {
    const other = (id: string, title: string) => ({ ...release(id, title, 1e9, 50, 'Indexer A'), categories: [8000] })
    searchReleases.mockResolvedValue([
      other('r', 'Дюна: Часть вторая / Dune: Part Two (2024) BDRemux 1080p'),
      other('o', 'Hans Zimmer - Dune: Part Two (Original Motion Picture Soundtrack) (2024) MP3'),
    ])
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByText('2 of 2 releases')).toBeInTheDocument()
  })

  it('searches a series by name alone, without a category, and shows its seasons', async () => {
    searchReleases.mockResolvedValue([release('s', 'Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x264-GRPC', 212e9, 486)])
    renderAt('/title/tv/1396/releases')
    expect(await screen.findByText('S01–S05')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Breaking Bad', expect.not.objectContaining({ categories: expect.anything() }))
  })

  // The row's place while the search runs, so the results don't push the list down (#393): whether
  // they do is the layout shift test's, which reads the built page.
  it('shows the filter chips’ row as skeletons while the search runs, and the chips once it answers', async () => {
    let answer!: (releases: typeof DUNE_RELEASES) => void
    searchReleases.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { container } = renderAt('/title/movie/693134/releases')
    await screen.findByText('Dune: Part Two · 2024')
    // Skeletons are decorative: only their class finds them.
    expect(container.querySelectorAll('.rel-chips .rel-chip-skel')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument()

    await act(async () => answer(DUNE_RELEASES))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(container.querySelectorAll('.rel-chip-skel')).toHaveLength(0)
  })

  it.each([
    ['Prowlarr fails', () => searchReleases.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'unreachable')), 'Prowlarr isn’t answering'],
    ['nothing is found', () => searchReleases.mockResolvedValue([]), 'No releases found'],
    ['TMDB fails', () => getMovie.mockRejectedValue(new tmdb.TmdbError('down', 502)), 'Couldn’t load from TMDB'],
  ])('keeps the filter chips’ row’s room, empty, when %s', async (_, set, heading) => {
    set()
    const { container } = renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    // Decorative, like the skeletons in it: only its class finds it.
    expect(container.querySelector('.rel-chips')).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument()
  })

  it('says TMDB didn’t answer for the title, and asks it again on Try again', async () => {
    getMovie.mockRejectedValueOnce(new tmdb.TmdbError('down', 502))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Couldn’t load from TMDB' })).toBeInTheDocument()
    expect(screen.getByText('Check the connection and try again.')).toBeInTheDocument()
    // Decorative, like the icon of Kinopeer's state: only its tag finds it.
    expect(screen.getByRole('button', { name: 'Try again' }).querySelector('svg')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Couldn’t load from TMDB' })).not.toBeInTheDocument())
    expect(getMovie).toHaveBeenCalledTimes(2)
  })

  it('says Kinopeer isn’t answering when the request to its server for the title failed, not TMDB', async () => {
    getMovie.mockRejectedValue(new TypeError('Failed to fetch'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    // Retry keeps its icon here, as Prowlarr's states have it on this screen; decorative, so only its tag finds it.
    expect(screen.getByRole('button', { name: 'Try again' }).querySelector('svg')).not.toBeNull()
    expect(searchReleases).not.toHaveBeenCalled()
  })

  it('explains a missing TMDB key and sends the user to enter it in Settings', async () => {
    getMovie.mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
    expect(screen.getByText(/Search needs a TMDB key/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter key' }))
    expect(screen.getByRole('heading', { name: /^Settings page/ })).toHaveTextContent('{"editTmdbKey":true}')
  })

  it('explains a missing Prowlarr setup', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrSetupError(503, 'not-configured'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t set up' })).toBeInTheDocument()
  })

  it('lists the releases without waiting to hear which indexers failed, then names them', async () => {
    // The search starts at 1000 ms and answers at 4000 ms.
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    searchReleases.mockImplementation(async () => {
      now = 4000
      return DUNE_RELEASES
    })
    let answer!: (names: string[]) => void
    vi.mocked(prowlarr.getFailingIndexers).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    const count = screen.getByText('3 of 3 releases')
    // Asked once the search answered, with how long ago it started. The request starts in an effect,
    // which can run after the list shows, so wait for it.
    await waitFor(() => expect(prowlarr.getFailingIndexers).toHaveBeenCalledWith(3000, expect.any(AbortSignal)))

    // Indexer D's releases are in this search's results: its failure was another client's query.
    answer(['Indexer B', 'Indexer D'])
    const failed = await within(count).findByRole('button', { name: '1 indexer didn’t answer' })
    await userEvent.click(failed)
    expect(document.getElementById(failed.getAttribute('aria-controls')!)).toHaveTextContent(/^Indexer B$/)
  })

  it('still lists releases when it can’t tell which indexers failed', async () => {
    let fail!: (error: unknown) => void
    vi.mocked(prowlarr.getFailingIndexers).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    // Failed only once it's asked: the request starts in an effect, which can run after the list
    // shows, and a promise rejected before anything handles it is an unhandled rejection.
    await waitFor(() => expect(prowlarr.getFailingIndexers).toHaveBeenCalled())

    await act(async () => fail(new prowlarr.ProwlarrError('down', 502, 'upstream')))
    expect(screen.getAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /didn’t answer/ })).not.toBeInTheDocument()
  })

  it('says when Prowlarr fails', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'unreachable'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t answering' })).toBeInTheDocument()
  })

  it('adds a release to qBittorrent tagged with the title and goes to downloads', async () => {
    vi.mocked(prowlarr.fetchRelease).mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1 })
    renderAt('/title/movie/693134/releases')
    const [top] = await screen.findAllByRole('article')
    await userEvent.click(within(top).getByRole('button', { name: 'Add to downloads' }))
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByText(DUNE_RELEASES[1].title)).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))

    expect(vi.mocked(qbt.addTorrents)).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['magnet:?xt=urn:btih:abc'], tags: ['tmdb:movie:693134'] }),
    )
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('names the movie’s files by its title and year, as the title’s details give them', async () => {
    vi.mocked(prowlarr.fetchRelease).mockResolvedValue({ kind: 'torrent', file: new File([duneTorrent().slice()], 'dune.torrent') })
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1 })
    renderAt('/title/movie/693134/releases')
    const [top] = await screen.findAllByRole('article')
    await userEvent.click(within(top).getByRole('button', { name: 'Add to downloads' }))
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    const names = await within(sheet).findByRole('switch', { name: 'Name files for a media server' })
    await waitFor(() => expect(names).toBeEnabled())
    await userEvent.click(names)
    expect(names).toHaveAccessibleDescription('Folder and video: “Dune - Part Two (2024)”')
  })

  it('opens a release qBittorrent has in place of adding it, over the releases', async () => {
    const hash = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
    searchReleases.mockResolvedValue([{ ...DUNE_RELEASES[1], infoHash: hash }, ...DUNE_RELEASES.filter((_, index) => index !== 1)])
    vi.mocked(qbt.getTorrents).mockResolvedValue([torrent(hash)])
    renderAt('/title/movie/693134/releases')
    const [top, ...rest] = await screen.findAllByRole('article')
    const open = await within(top).findByRole('link', { name: 'In downloads' })
    expect(within(top).queryByRole('button', { name: 'Add to downloads' })).not.toBeInTheDocument()
    for (const card of rest) expect(within(card).getByRole('button', { name: 'Add to downloads' })).toBeInTheDocument()

    await userEvent.click(open)
    expect(opened()).toBe(`/torrent/${hash} over /title/movie/693134/releases`)
  })

  it('goes to the title page when opened directly', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Title page' })).toBeInTheDocument()
  })

  describe('remembering filters', () => {
    it('starts the next search from the filters and the sort picked last, but not the indexer', async () => {
      const first = renderAt('/title/movie/693134/releases')
      await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
      const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
      await userEvent.click(sheet.getByRole('button', { name: counted('2160p') }))
      await userEvent.click(sheet.getByRole('button', { name: counted('1080p') }))
      await userEvent.click(sheet.getByRole('button', { name: counted('100+') }))
      await userEvent.click(within(sheet.getByRole('group', { name: 'Indexer' })).getByRole('button', { name: counted('Indexer D') }))
      await userEvent.click(sheet.getByRole('radio', { name: 'Size' }))
      first.unmount()

      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('2 of 3 releases')).toBeInTheDocument()
      for (const label of ['2160p', '1080p', '100+ seeds']) {
        expect(screen.getByRole('button', { name: `Remove filter ${label}` })).toBeInTheDocument()
      }
      expect(screen.queryByRole('button', { name: 'Remove filter Indexer D' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort: Size, Descending' })).toBeInTheDocument()
      expect(names()).toEqual([DUNE_RELEASES[0].title, DUNE_RELEASES[1].title])
    })

    it('keeps a remembered value set aside through a pick in the same filter', async () => {
      // No 2160p release is a WEB-DL, so the source gives way and WEB-DL is set aside.
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: [], source: ['WEB-DL'], minSeeds: 0 } })
      const first = renderAt('/title/movie/693134/releases')
      expect(await screen.findByText('Remembered filters not applied: WEB-DL')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Filters 1' }))
      await userEvent.click(within(screen.getByRole('group', { name: 'Source' })).getByRole('button', { name: counted('BluRay') }))
      first.unmount()

      searchReleases.mockResolvedValue([DUNE_RELEASES[1], DUNE_RELEASES[2]])
      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('2 of 2 releases')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter WEB-DL' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter BluRay' })).toBeInTheDocument()
    })

    it('forgets only the remembered filters set aside on Forget', async () => {
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 } })
      searchReleases.mockResolvedValue([DUNE_RELEASES[1], DUNE_RELEASES[2]])
      const first = renderAt('/title/movie/693134/releases')
      expect(await screen.findByText('Remembered filters not applied: 2160p')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter Dubbed' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
      expect(screen.queryByText(/^Remembered filters not applied/)).not.toBeInTheDocument()
      first.unmount()

      searchReleases.mockResolvedValue(DUNE_RELEASES)
      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('1 of 3 releases')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter Dubbed' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove filter 2160p' })).not.toBeInTheDocument()
    })

    it('forgets the filters on Clear all, and keeps the sort', async () => {
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: [], source: [], minSeeds: 0 }, releaseSort: { key: 'size', descending: false } })
      const first = renderAt('/title/movie/693134/releases')
      await userEvent.click(await screen.findByRole('button', { name: 'Clear all' }))
      first.unmount()

      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort: Size, Ascending' })).toBeInTheDocument()
    })
  })
})
