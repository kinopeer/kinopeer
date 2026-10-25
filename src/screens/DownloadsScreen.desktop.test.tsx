import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
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

function renderScreen(state?: unknown, onSelectingChange?: (selecting: boolean) => void) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <DownloadsScreen onSessionLost={vi.fn()} onSelectingChange={onSelectingChange} />
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

  it('shows a download as a row with its columns and a link to its details', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    const [dune, andor] = await tableRows()
    const cells = within(dune).getAllByRole('cell')
    expect(within(cells[0]).getByLabelText('Queue position 1')).toHaveTextContent('1')
    expect(within(dune).getByRole('link', { name: 'Dune.Part.Two.2024.2160p.WEB-DL' })).toHaveAttribute(
      'href',
      '/torrent/dune',
    )
    expect(within(dune).getByText('42%')).toBeInTheDocument()
    expect(within(dune).getByText('Downloading')).toBeInTheDocument()
    // The time left has its own column, and a copy under the speed for narrow tables (CSS shows one).
    expect(cells[5]).toHaveTextContent(/^↓ 4\.3 MB\/s12 min$/)
    expect(cells[6]).toHaveTextContent(/^12 min$/)
    expect(within(dune).getByText('8.99 GB / 21.4 GB')).toBeInTheDocument()
    expect(within(andor).getAllByText('—')).toHaveLength(1)
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
    expect(await screen.findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
  })

  it('pauses from the poster grid too', async () => {
    vi.mocked(api.stopTorrents).mockResolvedValue()
    renderScreen()
    await screen.findAllByRole('listitem')
    await userEvent.click(screen.getByRole('button', { name: 'Pause: Andor.S02.1080p' }))
    expect(api.stopTorrents).toHaveBeenCalledWith(['andor'])
  })

  it('opens a row’s actions as a menu next to its More button', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const more = screen.getByRole('button', { name: 'More actions: Alien.Romulus.2024.1080p' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(more)
    const menu = screen.getByRole('menu', { name: 'More actions: Alien.Romulus.2024.1080p' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Resume' })).toHaveFocus()
    expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toHaveAttribute('href', '/torrent/alien')
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('sorts from a menu and filters by type beside it', async () => {
    updateSettings({ downloadsDesktopView: 'list' })
    renderScreen()
    await tableRows()
    const sort = screen.getByRole('button', { name: 'Sort: Priority' })
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

  it('filters by status from a menu in place of the chips, counting within the type', async () => {
    getMainData.mockResolvedValue({
      ...SNAPSHOT,
      torrents: { ...SNAPSHOT.torrents, broken: torrent('broken', { name: 'Broken.2023.720p', state: 'missingFiles' }) },
    })
    renderScreen()
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('group', { name: 'Filter by status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Status: All, 4' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Paused, 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Status: Paused, 1. With errors: 1' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Series' }))
    expect(screen.getByRole('button', { name: 'Status: Paused, 0' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByRole('button', { name: 'Status: All, 4' })).toBeInTheDocument()
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
})
