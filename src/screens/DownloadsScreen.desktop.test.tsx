import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { getSettings, resetSettings, updateSettings } from '../settings/settings'
import { mainData, searchPage, torrent as fixtureTorrent } from '../test/fixtures'
import { renderWithRouter, saying } from '../test/render'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
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
  searchTitles.mockResolvedValue(searchPage([]))
  stubDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
})


/** The desktop list's body rows (the first row is the column headers). */
async function tableRows() {
  const table = await screen.findByRole('table', { name: 'Downloads' })
  const [, body] = within(table).getAllByRole('rowgroup')
  return within(body).getAllByRole('row')
}

describe('DownloadsScreen on desktop', () => {
  it('shows a poster grid by default, and a table when the list is picked, remembered apart from the phone', async () => {
    renderScreen()
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(getSettings()).toMatchObject({ downloadsDesktopView: 'list', downloadsView: 'list' })
    const headers = within(screen.getByRole('table', { name: 'Downloads' })).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      '#',
      'Poster',
      'Title',
      'Progress',
      'Status',
      'Speed',
      'ETA',
      'Size',
      'Actions',
    ])
  })

  it('leaves the speed limits switch to the sidebar', async () => {
    renderScreen()
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Alternative speed limits' })).not.toBeInTheDocument()
  })

  it('shows each download as a row in queue order, linking to its details', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    const rows = await tableRows()
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Dune.Part.Two.2024.2160p.WEB-DL',
      'Andor.S02.1080p',
      'Alien.Romulus.2024.1080p',
    ])
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/torrent/dune')
  })

  it('drops the "#" column when no torrent shown has a queue position', async () => {
    updateSettings({ downloadsDesktopView: 'list', downloadsSort: 'name' })
    const { unmount } = renderScreen()
    let [row] = await tableRows()
    let headers = within(screen.getByRole('table', { name: 'Downloads' })).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).not.toContain('#')
    expect(within(row).getAllByRole('cell')).toHaveLength(headers.length)
    unmount()

    // The queue order, but nothing is queued.
    updateSettings({ downloadsSort: 'priority' })
    getMainData.mockResolvedValue({
      ...SNAPSHOT,
      torrents: { andor: SNAPSHOT.torrents!.andor, alien: SNAPSHOT.torrents!.alien },
    })
    renderScreen()
    ;[row] = await tableRows()
    headers = within(screen.getByRole('table', { name: 'Downloads' })).getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Poster')
    expect(within(row).getAllByRole('cell')).toHaveLength(headers.length)

    // Selecting brings the column back for the checkboxes.
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    ;[row] = await tableRows()
    headers = within(screen.getByRole('table', { name: 'Downloads' })).getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Select')
    expect(within(within(row).getAllByRole('cell')[0]).getByRole('checkbox')).toBeInTheDocument()
  })

  it('pauses and resumes from a row', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    vi.mocked(api.stopTorrents).mockResolvedValue()
    vi.mocked(api.startTorrents).mockRejectedValue(new Error('500'))
    renderScreen()
    await tableRows()
    await userEvent.click(screen.getByRole('button', { name: 'Pause: Dune.Part.Two.2024.2160p.WEB-DL' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['dune'])

    await userEvent.click(screen.getByRole('button', { name: 'Resume: Alien.Romulus.2024.1080p' }))
    expect(api.startTorrents).toHaveBeenCalledWith(['alien'])
    expect(await screen.findByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()

    // Tried again: the failure goes at once, not after its time.
    vi.mocked(api.startTorrents).mockReturnValue(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: 'Resume: Alien.Romulus.2024.1080p' }))
    expect(screen.queryByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).not.toBeInTheDocument()
  })

  it('pauses from the poster grid too', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    renderScreen()
    await screen.findAllByRole('listitem')
    await userEvent.click(screen.getByRole('button', { name: 'Pause: Andor.S02.1080p' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor'])
  })

  it('opens a row’s actions as a menu next to its More button, not as a sheet', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const more = screen.getByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(more)
    expect(screen.getByRole('menu', { name: 'More actions: Alien.Romulus.2024.1080p' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the menu from its own More button', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const more = screen.getByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' })
    await userEvent.click(more)
    expect(screen.getByRole('menu', { name: 'More actions: Alien.Romulus.2024.1080p' })).toBeInTheDocument()
    await userEvent.click(more)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves the menu to another row’s More button', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Andor.S02.1080p' }))
    expect(screen.getByRole('menu', { name: 'More actions: Andor.S02.1080p' })).toBeInTheDocument()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('sorts from a menu and filters by type beside it', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const sort = screen.getByRole('button', { name: 'Sort: Priority, ascending' })
    expect(sort).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(sort)
    expect(sort).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Sort' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Priority' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Name' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(getSettings().downloadsSort).toBe('name')
    expect((await tableRows()).map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Alien.Romulus.2024.1080p',
      'Andor.S02.1080p',
      'Dune.Part.Two.2024.2160p.WEB-DL',
    ])

    await userEvent.click(screen.getByRole('radio', { name: 'Series' }))
    expect((await tableRows()).map((row) => within(row).getByRole('link').textContent)).toEqual(['Andor.S02.1080p'])
  })

  it('sorts by a column’s header, reverses on the next click, and shows the direction on the sort button', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const titles = async () => (await tableRows()).map((row) => within(row).getByRole('link').textContent)
    const header = (name: string) => screen.getByRole('columnheader', { name })

    await userEvent.click(screen.getByRole('button', { name: 'Title' }))
    expect(await titles()).toEqual(['Alien.Romulus.2024.1080p', 'Andor.S02.1080p', 'Dune.Part.Two.2024.2160p.WEB-DL'])
    expect(header('Title')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('button', { name: 'Sort: Name, ascending' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Title' }))
    expect(await titles()).toEqual(['Dune.Part.Two.2024.2160p.WEB-DL', 'Andor.S02.1080p', 'Alien.Romulus.2024.1080p'])
    expect(header('Title')).toHaveAttribute('aria-sort', 'descending')
    expect(getSettings()).toMatchObject({ downloadsSort: 'name', downloadsSortDescending: true })

    // The menu picks a sort in its usual direction, the one it's in included.
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Name, descending' }))
    await userEvent.click(within(screen.getByRole('menu', { name: 'Sort' })).getByRole('menuitemradio', { name: 'Name' }))
    expect(header('Title')).toHaveAttribute('aria-sort', 'ascending')
    expect(getSettings()).toMatchObject({ downloadsSort: 'name', downloadsSortDescending: false })
  })

  it('filters by status from a menu in place of the chips, counting within the type', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('group', { name: 'Filter by status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Status: All, 3' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paused, 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Status: Paused, 1' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Series' }))
    expect(screen.getByRole('button', { name: 'Status: Paused, 0' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByRole('button', { name: 'Status: All, 3' })).toBeInTheDocument()
  })

  it('keeps the name filter in the header', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Filter by name' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'andor')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('selects rows of the table with checkboxes', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    expect(screen.getByRole('toolbar', { name: '1 selected' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Andor.S02.1080p' })).not.toBeInTheDocument()
  })

  it('pauses the selected torrents in one request, without one whose pause is already on its way', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    vi.mocked(api.stopTorrents).mockReturnValue(new Promise(() => {}))
    renderWithRouter(
      <TorrentRequestsProvider>
        <DownloadsScreen onSessionLost={vi.fn()} />
      </TorrentRequestsProvider>,
    )
    await tableRows()
    await userEvent.click(screen.getByRole('button', { name: 'Pause: Dune.Part.Two.2024.2160p.WEB-DL' }))
    expect(screen.getByRole('button', { name: 'Pause: Dune.Part.Two.2024.2160p.WEB-DL' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /^Dune/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Andor.S02.1080p' }))
    await userEvent.click(within(screen.getByRole('toolbar', { name: '2 selected' })).getByRole('button', { name: 'Pause' }))
    expect(api.stopTorrents).toHaveBeenLastCalledWith(['andor'])
    expect(api.stopTorrents).toHaveBeenCalledTimes(2)
  })
})
