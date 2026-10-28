import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { getSettings, resetSettings, updateSettings } from '../settings/settings'
import { mainData, title, torrent as fixtureTorrent } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { DownloadsScreen } from './DownloadsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getMainData: vi.fn(),
    stopTorrents: vi.fn(),
    startTorrents: vi.fn(),
    deleteTorrents: vi.fn(),
    recheckTorrents: vi.fn(),
    reannounceTorrents: vi.fn(),
  }
})

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn() }
})

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

const getMainData = vi.mocked(api.getMainData)
const searchTitles = vi.mocked(tmdb.searchTitles)

/** A torrent as this screen's rows expect it: 1 GB and added at the epoch, the rest from the shared fixture. */
const torrent = (hash: string, fields: Partial<Torrent>) => fixtureTorrent(hash, { size: 1_000_000_000, added_on: 0, ...fields })

const SNAPSHOT: MainData = mainData(
  [
    torrent('dune', {
      name: 'Dune.Part.Two.2024.2160p.WEB-DL',
      progress: 0.42,
      dlspeed: 4_300_000,
      eta: 720,
      priority: 1,
      size: 21_400_000_000,
    }),
    torrent('andor', { name: 'Andor.S02.1080p', state: 'uploading', progress: 1, upspeed: 120_000 }),
    torrent('alien', { name: 'Alien.Romulus.2024.1080p', state: 'stoppedDL', progress: 0.1 }),
  ],
  { free_space_on_disk: 1_210_000_000_000 },
)

const DUNE_TITLE = title('movie', 693134, 'Dune: Part Two', 2024, { posterPath: null, rating: 8 })
const ANDOR_TITLE = title('tv', 83867, 'Andor', 2022, { posterPath: null, rating: 8 })

function renderScreen(state?: unknown, onSelectingChange?: (selecting: boolean) => void) {
  return renderWithRouter(<DownloadsScreen onSessionLost={vi.fn()} onSelectingChange={onSelectingChange} />, [{ pathname: '/', state }])
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  resetServerMatches()
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  resetSettings()
  getMainData.mockResolvedValue(SNAPSHOT)
  searchTitles.mockResolvedValue({ titles: [], page: 1, totalPages: 1 })
})

describe('DownloadsScreen', () => {
  it('shows a loading state, then the torrents in queue order', async () => {
    getMainData.mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Loading downloads')
    unmount()

    renderScreen()
    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Dune.Part.Two.2024.2160p.WEB-DL',
      'Andor.S02.1080p',
      'Alien.Romulus.2024.1080p',
    ])
  })

  it('shows the TMDB title and poster once matched, with the release name below', async () => {
    searchTitles.mockImplementation(async (query) => ({
      titles:
        query === 'Dune Part Two'
          ? [{ type: 'movie', id: 693134, title: 'Dune: Part Two', originalTitle: 'Dune: Part Two', year: 2024, overview: '', posterPath: '/dune.jpg', backdropPath: null, rating: 8 }]
          : [],
      page: 1,
      totalPages: 1,
    }))
    const { container } = renderScreen()
    expect(await screen.findByText('Dune: Part Two')).toBeInTheDocument()
    const [dune] = screen.getAllByRole('listitem')
    expect(within(dune).getByRole('heading')).toHaveTextContent('Dune: Part Two2024')
    expect(within(dune).getByText('Dune.Part.Two.2024.2160p.WEB-DL')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w185/dune.jpg')
    expect(within(dune).getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toBeInTheDocument()
  })

  it('switches to a poster grid and remembers it', async () => {
    searchTitles.mockImplementation(async (query) => ({
      titles:
        query === 'Dune Part Two'
          ? [{ type: 'movie', id: 693134, title: 'Dune: Part Two', originalTitle: 'Dune: Part Two', year: 2024, overview: '', posterPath: '/dune.jpg', backdropPath: null, rating: 8 }]
          : [],
      page: 1,
      totalPages: 1,
    }))
    const { container, unmount } = renderScreen()
    await screen.findByText('Dune: Part Two')
    const view = within(screen.getByRole('radiogroup', { name: 'View' }))
    expect(view.getByRole('radio', { name: 'List', checked: true })).toBeInTheDocument()

    await userEvent.click(view.getByRole('radio', { name: 'Grid' }))
    expect(view.getByRole('radio', { name: 'Grid', checked: true })).toBeInTheDocument()
    expect(getSettings().downloadsView).toBe('grid')
    const [dune, andor] = screen.getAllByRole('listitem')
    expect(within(dune).getByRole('heading')).toHaveTextContent('Dune: Part Two')
    expect(within(dune).getByText('42% · ↓ 4.3 MB/s')).toBeInTheDocument()
    expect(within(dune).getByText('Downloading')).toBeInTheDocument()
    expect(within(dune).getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(within(dune).getByLabelText('Queue position 1')).toBeInTheDocument()
    expect(within(dune).getByRole('link')).toHaveAttribute('href', '/torrent/dune')
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w342/dune.jpg')
    expect(within(andor).getByText('100% · ↑ 120 KB/s')).toBeInTheDocument()
    unmount()

    renderScreen()
    expect(await screen.findByRole('radio', { name: 'Grid', checked: true })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('shows the release name in the grid until a title is matched', async () => {
    updateSettings({ downloadsView: 'grid' })
    renderScreen()
    const cards = await screen.findAllByRole('listitem')
    expect(within(cards[2]).getByRole('heading', { name: 'Alien.Romulus.2024.1080p' })).toBeInTheDocument()
  })

  it('shows placeholder cards while loading in the grid', () => {
    updateSettings({ downloadsView: 'grid' })
    getMainData.mockReturnValue(new Promise(() => {}))
    renderScreen()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading downloads')
    // Placeholders are hidden from assistive tech; the live region names the state instead.
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
  })

  it('shows transfer totals and free space', async () => {
    renderScreen()
    expect(await screen.findByText('1.21 TB free')).toBeInTheDocument()
    expect(screen.getByText('Download speed').parentElement).toHaveTextContent('4.3 MB/s')
    expect(screen.getByText('Upload speed').parentElement).toHaveTextContent('120 KB/s')
  })

  it('filters by status with counts', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    const filters = within(screen.getByRole('group', { name: 'Filter by status' }))
    expect(filters.getByRole('button', { name: 'All 3', pressed: true })).toBeInTheDocument()

    await userEvent.click(filters.getByRole('button', { name: 'Seeding 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Andor.S02.1080p' })).toBeInTheDocument()

    await userEvent.click(filters.getByRole('button', { name: 'Error 0' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('sorts the list, hides queue positions outside the queue order and remembers the sort', async () => {
    const headings = () => screen.getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)
    const { unmount } = renderScreen()
    await screen.findAllByRole('listitem')
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Priority' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Sort & filter' }))
    expect(sheet.getByRole('radio', { name: 'Priority', checked: true })).toBeInTheDocument()
    expect(sheet.getByRole('radio', { name: 'Priority' })).toHaveAccessibleDescription('Queue order')

    await userEvent.click(sheet.getByRole('radio', { name: 'Name' }))
    expect(sheet.getByRole('radio', { name: 'Name', checked: true })).toBeInTheDocument()
    expect(headings()).toEqual(['Alien.Romulus.2024.1080p', 'Andor.S02.1080p', 'Dune.Part.Two.2024.2160p.WEB-DL'])
    expect(screen.queryByLabelText(/Queue position/)).not.toBeInTheDocument()
    expect(getSettings().downloadsSort).toBe('name')

    await userEvent.click(sheet.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    renderScreen()
    await screen.findAllByRole('listitem')
    expect(screen.getByRole('button', { name: 'Sort: Name' })).toHaveTextContent('Name')
    expect(headings()[0]).toBe('Alien.Romulus.2024.1080p')
  })

  it('filters by type, counting within it, and resets it with the other filters', async () => {
    searchTitles.mockImplementation(async (query) => ({
      titles: query === 'Dune Part Two' ? [DUNE_TITLE] : [],
      page: 1,
      totalPages: 1,
    }))
    renderScreen()
    await screen.findByText('Dune: Part Two')
    expect(screen.getByRole('button', { name: 'Sort: Priority' })).not.toHaveTextContent('Series')
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Priority' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Sort & filter' }))
    const types = within(sheet.getByRole('radiogroup', { name: 'Type' }))
    expect(types.getByRole('radio', { name: 'All', checked: true })).toBeInTheDocument()

    // Season markers make Andor a series; Alien has no title and no markers, so it shows only under All.
    await userEvent.click(types.getByRole('radio', { name: 'Series' }))
    expect(screen.getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Andor.S02.1080p',
    ])
    await userEvent.click(types.getByRole('radio', { name: 'Movies' }))
    expect(screen.getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Dune: Part Two2024',
    ])
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Sort: Priority, Movies' })).toHaveTextContent('Movies')

    const filters = within(screen.getByRole('group', { name: 'Filter by status' }))
    expect(filters.getByRole('button', { name: 'All 1', pressed: true })).toBeInTheDocument()
    await userEvent.click(filters.getByRole('button', { name: 'Seeding 0' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Sort: Priority' })).toBeInTheDocument()
  })

  it('sorts by the TMDB title once matched', async () => {
    updateSettings({ downloadsSort: 'name' })
    searchTitles.mockImplementation(async (query) => ({
      titles: query === 'Andor' ? [{ ...ANDOR_TITLE, title: 'Zorro' }] : [],
      page: 1,
      totalPages: 1,
    }))
    renderScreen()
    await screen.findByText('Zorro')
    expect(screen.getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Alien.Romulus.2024.1080p',
      'Dune.Part.Two.2024.2160p.WEB-DL',
      'Zorro2022',
    ])
  })

  it('filters by name', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    await userEvent.click(screen.getByRole('button', { name: 'Filter by name', pressed: false }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'alien')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Filter by name', pressed: true }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('links each row to the torrent page', async () => {
    renderScreen()
    expect(await screen.findByRole('link', { name: /Andor\.S02\.1080p/ })).toHaveAttribute('href', '/torrent/andor')
  })

  it('pauses a torrent from the row menu', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    const sheet = screen.getByRole('dialog', { name: 'Andor.S02.1080p' })
    expect(within(sheet).getByRole('link', { name: 'Open details' })).toHaveAttribute('href', '/torrent/andor')
    // No title yet, so no title page to open.
    expect(within(sheet).queryByRole('link', { name: /page$/ })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Pause' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes a torrent from the row menu after confirmation', async () => {
    vi.mocked(api.deleteTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(api.deleteTorrents).toHaveBeenCalledWith(['andor'], false)
    expect(await screen.findByText('Torrent deleted')).toBeInTheDocument()
  })

  it('reannounces a torrent from the row menu, and rechecks it after confirmation', async () => {
    vi.mocked(api.recheckTorrents).mockResolvedValue()
    vi.mocked(api.reannounceTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['andor'])
    expect(await screen.findByRole('status')).toHaveTextContent('Announced to the trackers')

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Force recheck' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Recheck the files?' })
    // The list asks qBittorrent again right after the recheck, so the row shows Checking without waiting for the poll.
    getMainData.mockResolvedValue({
      ...SNAPSHOT,
      torrents: { ...SNAPSHOT.torrents, andor: { ...SNAPSHOT.torrents!.andor, state: 'checkingUP' } },
    })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Force recheck' }))
    expect(api.recheckTorrents).toHaveBeenCalledWith(['andor'])
    expect(await screen.findByRole('status')).toHaveTextContent('Checking the files')
    const andor = screen.getByRole('link', { name: /Andor\.S02\.1080p/ }).closest('li')!
    expect(await within(andor).findByText('Checking', { exact: true }, { timeout: 1000 })).toBeInTheDocument()
  })

  it('drops a recheck confirmation whose torrent went away, so it doesn’t open again when the torrent is back', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Force recheck' }))
    expect(screen.getByRole('alertdialog', { name: 'Recheck the files?' })).toBeInTheDocument()

    const { andor, ...others } = SNAPSHOT.torrents!
    getMainData.mockResolvedValue({ ...SNAPSHOT, torrents: others })
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'More actions: Andor.S02.1080p' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    getMainData.mockResolvedValue({ ...SNAPSHOT, torrents: { ...others, andor } })
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks in the row menu whether a guessed title is right, and saves the confirmation', async () => {
    searchTitles.mockImplementation(async (query) => ({
      titles: query === 'Dune Part Two' ? [DUNE_TITLE] : [],
      page: 1,
      totalPages: 1,
    }))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    const sheet = screen.getByRole('dialog', { name: 'Dune: Part Two' })
    expect(within(sheet).getByText('Matched by the release name. Is it right?')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Change title' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Movie page' })).toHaveAttribute('href', '/title/movie/693134')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Yes, right' }))
    expect(await screen.findByText('Match confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('picks a title from the row menu for a torrent with none', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    searchTitles.mockResolvedValue({ titles: [ANDOR_TITLE], page: 1, totalPages: 1 })
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pick title' }))
    const sheet = screen.getByRole('dialog', { name: 'Pick title' })
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Andor/ }))
    expect(await screen.findByText('Title changed')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Andor' }))
    expect(within(screen.getByRole('dialog', { name: 'Andor' })).getByRole('link', { name: 'Series page' })).toHaveAttribute(
      'href',
      '/title/tv/83867',
    )
  })

  it('confirms a torrent deleted on the torrent page', async () => {
    renderScreen({ deleted: 'files' })
    expect(screen.getByText('Torrent and files deleted')).toBeInTheDocument()
  })

  it('confirms a release added from the releases screen', async () => {
    renderScreen({ added: 'Dune: Part Two' })
    expect(screen.getByText('“Dune: Part Two” added to downloads')).toBeInTheDocument()
  })

  it('shows the empty state without torrents', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true })
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'No downloads yet' })).toBeInTheDocument()
  })

  it('says when qBittorrent can’t be reached at all, and when it answers again', async () => {
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Can’t reach qBittorrent' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('heading', { name: 'Can’t reach qBittorrent' })).not.toBeInTheDocument()
    expect(screen.getByText('Reconnected to qBittorrent')).toBeInTheDocument()
  })

  it('keeps the last state with its age when qBittorrent stops answering', async () => {
    renderScreen()
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)

    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('No connection to qBittorrent')).toBeInTheDocument()
    expect(screen.getByText('Updated just now · actions paused')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('DownloadsScreen selection', () => {
  const bulkBar = () => screen.getByRole('toolbar')

  it('selects downloads by tapping their rows and pauses them together', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    const onSelectingChange = vi.fn()
    renderScreen(undefined, onSelectingChange)
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    expect(onSelectingChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('heading', { name: '0 selected' })).toBeInTheDocument()
    // Rows toggle instead of opening the torrent, and have no menu.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More actions/ })).not.toBeInTheDocument()
    expect(within(bulkBar()).getByRole('button', { name: 'Pause' })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Dune.Part.Two.2024.2160p.WEB-DL' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    expect(screen.getByRole('heading', { name: '2 selected' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: '2 selected' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dune.Part.Two.2024.2160p.WEB-DL', checked: true }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alien.Romulus.2024.1080p' }))

    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Pause' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor', 'alien'])
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
    expect(onSelectingChange).toHaveBeenLastCalledWith(false)
  })

  it('resumes the selected downloads', async () => {
    vi.mocked(api.startTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alien.Romulus.2024.1080p' }))
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Resume' }))
    expect(api.startTorrents).toHaveBeenCalledWith(['alien'])
  })

  it('keeps the selection and says so when qBittorrent doesn’t answer', async () => {
    vi.mocked(api.stopTorrents).mockRejectedValue(new TypeError('Failed to fetch'))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Pause' }))
    expect(await screen.findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Andor.S02.1080p', checked: true })).toBeInTheDocument()
  })

  it('selects all the downloads on screen, and only those', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByRole('heading', { name: '3 selected' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(screen.getByRole('heading', { name: '0 selected' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    // A filter leaves the hidden torrents out of the actions.
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: 'Seeding 1' }))
    expect(screen.getByRole('heading', { name: '1 selected' })).toBeInTheDocument()
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Pause' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor'])
  })

  it('deletes the selected downloads after confirmation', async () => {
    vi.mocked(api.deleteTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dune.Part.Two.2024.2160p.WEB-DL' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alien.Romulus.2024.1080p' }))
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Delete' }))

    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrents?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(api.deleteTorrents).toHaveBeenCalledWith(['dune', 'alien'], false)
    expect(await screen.findByText('2 torrents deleted')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('selects cards in the poster grid', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    updateSettings({ downloadsView: 'grid' })
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More actions/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Pause' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor'])
  })

  it('leaves selection on Cancel', async () => {
    const onSelectingChange = vi.fn()
    renderScreen(undefined, onSelectingChange)
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(onSelectingChange).toHaveBeenLastCalledWith(false)

    // A new selection starts empty.
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByRole('heading', { name: '0 selected' })).toBeInTheDocument()
  })

  it('can’t select while qBittorrent is unreachable', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('No connection to qBittorrent')).toBeInTheDocument()
    for (const name of ['Pause', 'Resume', 'Delete']) {
      expect(within(bulkBar()).getByRole('button', { name })).toBeDisabled()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
  })
})
