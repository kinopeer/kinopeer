import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { resetSettings, updateSettings } from '../settings/settings'
import { renderWithRouter } from '../test/render'
import { MainDataProvider } from '../torrents/MainDataProvider'
import * as serverMatches from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { DownloadsWithDrawer } from './DownloadsWithDrawer'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getMainData: vi.fn(),
    getTorrentTrackers: vi.fn(),
    getTorrentFiles: vi.fn(),
    setFilePriority: vi.fn(),
    startTorrents: vi.fn(),
    stopTorrents: vi.fn(),
    deleteTorrents: vi.fn(),
  }
})

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), searchTitles: vi.fn() }
})

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

vi.mock('../torrents/serverMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof serverMatches>()),
  forgetMatches: vi.fn(),
}))

const getMainData = vi.mocked(api.getMainData)
const getTorrentTrackers = vi.mocked(api.getTorrentTrackers)
const getTorrentFiles = vi.mocked(api.getTorrentFiles)
const setFilePriority = vi.mocked(api.setFilePriority)
const startTorrents = vi.mocked(api.startTorrents)
const stopTorrents = vi.mocked(api.stopTorrents)
const deleteTorrents = vi.mocked(api.deleteTorrents)

const DUNE: Partial<Torrent> = {
  name: 'Dune.Part.Two.2024.2160p.WEB-DL',
  state: 'downloading',
  progress: 0.42,
  size: 20_000_000_000,
  dlspeed: 4_300_000,
  upspeed: 120_000,
  eta: 720,
  ratio: 0.31,
  num_seeds: 12,
  num_complete: 340,
  num_leechs: 3,
  num_incomplete: 41,
  category: 'Movies',
  tags: 'tmdb:movie:693134',
  save_path: '/data/movies',
  added_on: 1_760_000_000,
  priority: 1,
}

function snapshot(fields: Partial<Torrent> = {}): MainData {
  return { rid: 1, full_update: true, torrents: { dune: { ...DUNE, ...fields } }, server_state: {} }
}

function Where() {
  const location = useLocation()
  return <output aria-label="Location">{location.pathname}</output>
}

/** The desktop routes as App sets them up, under the shared poll. */
function renderApp(entries: string[]) {
  return renderWithRouter(
    <MainDataProvider onUnauthorized={vi.fn()}>
      <Routes>
        <Route element={<DownloadsWithDrawer onSessionLost={vi.fn()} />}>
          <Route index />
          <Route path="torrent/:hash" />
        </Route>
        <Route path="title/:type/:id" element={<p>Title page</p>} />
      </Routes>
      <Where />
    </MainDataProvider>,
    entries,
  )
}

const where = () => screen.getByRole('status', { name: 'Location' }).textContent

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  serverMatches.resetServerMatches()
  resetSettings()
  updateSettings({ downloadsDesktopView: 'list' })
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  getMainData.mockResolvedValue(snapshot())
  vi.mocked(tmdb.getMovie).mockResolvedValue({
    id: 693134,
    title: 'Dune: Part Two',
    original_title: 'Dune: Part Two',
    release_date: '2024-02-27',
    poster_path: '/dune.jpg',
  } as Awaited<ReturnType<typeof tmdb.getMovie>>)
  getTorrentFiles.mockResolvedValue([])
  getTorrentTrackers.mockResolvedValue([])
  setFilePriority.mockResolvedValue()
  startTorrents.mockResolvedValue()
  stopTorrents.mockResolvedValue()
  deleteTorrents.mockResolvedValue()
  stubDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the details drawer on desktop', () => {
  it('shows the torrent in a modal drawer over Downloads, sharing one poll', async () => {
    renderApp(['/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(within(drawer).getByRole('heading', { level: 2, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(within(drawer).getByText('42%')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(screen.getByRole('table', { name: 'Downloads' })).toBeInTheDocument()
    expect(getMainData).toHaveBeenCalledTimes(1)
  })

  it('opens from a row and goes back to the list on Escape, focus back on the row', async () => {
    renderApp(['/'])
    const link = await screen.findByRole('link', { name: /^Dune: Part Two/ })
    await userEvent.click(link)
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    expect(where()).toBe('/torrent/dune')

    fireEvent(drawer, new Event('cancel', { cancelable: true }))
    expect(await screen.findByText('/')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(link).toHaveFocus()
  })

  it('closes with the Close button and a click on the backdrop', async () => {
    renderApp(['/', '/torrent/dune'])
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    await userEvent.click(await screen.findByRole('dialog'))
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opened from elsewhere, closes to Downloads', async () => {
    renderApp(['/title/movie/693134', '/torrent/dune'])
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(where()).toBe('/')
    expect(screen.getByRole('table', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('opens its More actions as a menu without "Open details"', async () => {
    renderApp(['/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'More actions: Dune: Part Two' }))
    const menu = within(drawer).getByRole('menu', { name: 'More actions: Dune: Part Two' })
    expect(within(menu).queryByRole('menuitem', { name: 'Open details' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Movie page' })).toHaveAttribute('href', '/title/movie/693134')
  })

  it('goes back to Downloads with a toast after deleting', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(deleteTorrents).toHaveBeenCalledWith(['dune'], false)
    expect(await screen.findByText('Torrent deleted')).toBeInTheDocument()
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog', { name: 'Dune: Part Two' })).not.toBeInTheDocument()
  })
})
