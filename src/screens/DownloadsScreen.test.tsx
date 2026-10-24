import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { getSettings, resetSettings, updateSettings } from '../settings/settings'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { DownloadsScreen } from './DownloadsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getMainData: vi.fn(), stopTorrents: vi.fn(), startTorrents: vi.fn(), deleteTorrents: vi.fn() }
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

function torrent(hash: string, fields: Partial<Torrent>): Partial<Torrent> {
  return {
    name: hash,
    state: 'downloading',
    progress: 0,
    size: 1_000_000_000,
    dlspeed: 0,
    upspeed: 0,
    eta: 8_640_000,
    priority: -1,
    added_on: 0,
    ...fields,
  }
}

const SNAPSHOT: MainData = {
  rid: 1,
  full_update: true,
  torrents: {
    dune: torrent('dune', {
      name: 'Dune.Part.Two.2024.2160p.WEB-DL',
      progress: 0.42,
      dlspeed: 4_300_000,
      eta: 720,
      priority: 1,
      size: 21_400_000_000,
    }),
    andor: torrent('andor', { name: 'Andor.S02.1080p', state: 'uploading', progress: 1, upspeed: 120_000 }),
    alien: torrent('alien', { name: 'Alien.Romulus.2024.1080p', state: 'stoppedDL', progress: 0.1 }),
  },
  server_state: { dl_info_speed: 4_300_000, up_info_speed: 120_000, free_space_on_disk: 1_210_000_000_000 },
}

function title(type: tmdb.Title['type'], id: number, name: string, year: number): tmdb.Title {
  return { type, id, title: name, originalTitle: name, year, overview: '', posterPath: null, backdropPath: null, rating: 8 }
}

const DUNE_TITLE = title('movie', 693134, 'Dune: Part Two', 2024)
const ANDOR_TITLE = title('tv', 83867, 'Andor', 2022)

function renderScreen(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <DownloadsScreen onSessionLost={vi.fn()} />
    </MemoryRouter>,
  )
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

  it('shows progress, speed, ETA and size for a download', async () => {
    renderScreen()
    const [dune] = await screen.findAllByRole('listitem')
    const row = within(dune)
    expect(row.getByRole('progressbar', { name: 'Dune.Part.Two.2024.2160p.WEB-DL: progress' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(row.getByText('42%')).toBeInTheDocument()
    expect(row.getByText('Downloading')).toBeInTheDocument()
    expect(row.getByText('↓ 4.3 MB/s')).toBeInTheDocument()
    expect(row.getByText('12 min')).toBeInTheDocument()
    expect(row.getByText('8.99 GB / 21.4 GB')).toBeInTheDocument()
    expect(row.getByLabelText('Queue position 1')).toBeInTheDocument()
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

  it('shows the release name, a placeholder poster and the size in the grid until a title is matched', async () => {
    updateSettings({ downloadsView: 'grid' })
    const { container } = renderScreen()
    const cards = await screen.findAllByRole('listitem')
    const alien = within(cards[2])
    expect(alien.getByRole('heading', { name: 'Alien.Romulus.2024.1080p' })).toBeInTheDocument()
    expect(alien.getByText(/^10% · 1(\.00)?\sGB$/)).toBeInTheDocument()
    expect(alien.getByText('Paused')).toBeInTheDocument()
    expect(alien.queryByLabelText(/Queue position/)).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelectorAll('.ks-poster-none')).toHaveLength(3)
  })

  it('shows placeholder cards while loading in the grid', () => {
    updateSettings({ downloadsView: 'grid' })
    getMainData.mockReturnValue(new Promise(() => {}))
    const { container } = renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Loading downloads')
    expect(container.querySelectorAll('.ks-pcard[aria-hidden="true"]')).toHaveLength(4)
    expect(container.querySelector('.dl-skeleton')).toBeNull()
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

  it('offers Resume for a paused torrent', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' })).toBeInTheDocument()
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
    expect(matchesApi.saveMatches).toHaveBeenCalledWith({ dune: { type: 'movie', id: 693134, source: 'user' } })
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
    expect(matchesApi.saveMatches).toHaveBeenCalledWith({ andor: { type: 'tv', id: 83867, source: 'user' } })
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
