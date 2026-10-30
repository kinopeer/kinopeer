import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { resetSettings, updateSettings } from '../settings/settings'
import { DUNE_TORRENT, mainData, title } from '../test/fixtures'
import { Where, renderWithRouter, saying, where } from '../test/render'
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

const snapshot = (fields: Partial<Torrent> = {}) => mainData([{ ...DUNE_TORRENT, ...fields }])

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

  it('goes back to Downloads with a toast after deleting', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog', { name: 'Dune: Part Two' })).not.toBeInTheDocument()
  })

  it('shows a toast from Downloads inside the drawer, since the page behind it is inert', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    window.dispatchEvent(new Event('online'))
    expect(await within(drawer).findByText('No connection to qBittorrent')).toBeInTheDocument()

    window.dispatchEvent(new Event('online'))
    // Downloads says it, under the drawer.
    expect(await within(drawer).findByRole('status', { name: saying('Reconnected to qBittorrent') })).toBeInTheDocument()
  })

  it('stays open when Escape cancels its delete confirmation', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })

    // jsdom doesn't turn Escape into the dialog's cancel event, so it's sent the way a browser does.
    fireEvent(confirm, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(where()).toBe('/torrent/dune')
    expect(deleteTorrents).not.toHaveBeenCalled()
  })

  describe('the More menu', () => {
    const openMenu = async (name = 'Dune: Part Two') => {
      const drawer = await screen.findByRole('dialog', { name })
      await userEvent.click(within(drawer).getByRole('button', { name: `More actions: ${name}` }))
      return within(drawer).getByRole('menu', { name: `More actions: ${name}` })
    }

    it('opens and closes from its More button, which says whether it’s open', async () => {
      renderApp(['/', '/torrent/dune'])
      await openMenu()
      const more = within(screen.getByRole('dialog', { name: 'Dune: Part Two' })).getByRole('button', { name: 'More actions: Dune: Part Two' })
      expect(more).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(more)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(more).toHaveAttribute('aria-expanded', 'false')
    })

    it('deletes after confirming', async () => {
      renderApp(['/', '/torrent/dune'])
      const menu = await openMenu()
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
      expect(await screen.findByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
      expect(where()).toBe('/')
    })

    it('opens the title search from Change title, which Escape closes alone', async () => {
      vi.mocked(tmdb.searchTitles).mockResolvedValue({ titles: [title('movie', 693134, 'Dune: Part Two', 2024)], page: 1, totalPages: 1 })
      renderApp(['/torrent/dune'])
      const menu = await openMenu()
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change title' }))
      const sheet = screen.getByRole('dialog', { name: 'Change title' })
      expect(within(sheet).getByRole('searchbox', { name: 'Search TMDB' })).toHaveValue('Dune Part Two')
      expect(await within(sheet).findByRole('button', { name: /^Dune: Part Two/ })).toHaveAttribute('aria-current', 'true')

      fireEvent(sheet, new Event('cancel', { cancelable: true }))
      expect(screen.queryByRole('dialog', { name: 'Change title' })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Dune: Part Two' })).toBeInTheDocument()
      expect(where()).toBe('/torrent/dune')
    })

    it('confirms a guessed title with a toast', async () => {
      getMainData.mockResolvedValue(snapshot({ tags: '' }))
      vi.mocked(tmdb.searchTitles).mockResolvedValue({ titles: [title('movie', 693134, 'Dune: Part Two', 2024)], page: 1, totalPages: 1 })
      renderApp(['/torrent/dune'])
      const menu = await openMenu()
      const guess = within(menu).getByRole('group', { name: 'Matched by the release name. Is it right?' })
      await userEvent.click(within(guess).getByRole('menuitem', { name: 'Yes, right' }))
      expect(await screen.findByRole('status', { name: saying('Match confirmed') })).toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
