import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { To } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from './api/matches'
import * as api from './api/qbittorrent'
import * as serverSettings from './api/settings'
import * as tmdb from './api/tmdb'
import App from './App'
import { stubDesktop } from './lib/stubDesktop'
import { Where, renderWithRouter, where } from './test/render'

vi.mock('./api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getAppVersion: vi.fn(),
    getApiVersion: vi.fn(),
    getCategories: vi.fn(),
    getMainData: vi.fn(),
    getTorrentFiles: vi.fn(),
    deleteTorrents: vi.fn(),
    getSaveLocations: vi.fn(),
    setTorrentLocation: vi.fn(),
    toggleSpeedLimitsMode: vi.fn(),
  }
})

vi.mock('./api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

vi.mock('./api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof serverSettings>()
  return { ...actual, getServerSettings: vi.fn(), saveTmdbKey: vi.fn() }
})

vi.mock('./api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, discoverTitles: vi.fn(), getMovie: vi.fn() }
})

function renderApp(path: string | (Exclude<To, string> & { state?: unknown }) = '/') {
  return renderWithRouter(
    <>
      <App />
      <Where />
    </>,
    [path],
  )
}

const getAppVersion = vi.mocked(api.getAppVersion)
const getMainData = vi.mocked(api.getMainData)

beforeEach(() => {
  vi.resetAllMocks()
  getAppVersion.mockResolvedValue('v5.2.4')
  vi.mocked(api.getApiVersion).mockResolvedValue('2.11.4')
  vi.mocked(api.getCategories).mockResolvedValue([])
  getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: {} })
  const empty = { titles: [], page: 1, totalPages: 1 }
  vi.mocked(tmdb.discoverTitles).mockResolvedValue(empty)
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  vi.mocked(api.getTorrentFiles).mockResolvedValue([])
  vi.mocked(api.deleteTorrents).mockResolvedValue()
  vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('goes straight in when qBittorrent needs no login', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('navigates between tabs', async () => {
    renderApp()
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Downloads' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(within(nav).getByRole('link', { name: 'Search' }))
    expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByText('Connected · qBittorrent v5.2.4 · API 2.11.4')).toBeInTheDocument()
  })

  it('puts the selection’s actions in place of the tab bar while selecting downloads', async () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: { dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1 } },
      server_state: {},
    })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: '0 selected' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  describe('on desktop', () => {
    beforeEach(() => {
      stubDesktop()
    })

    it('navigates from the sidebar in place of the tab bar', async () => {
      renderApp()
      const nav = await screen.findByRole('navigation', { name: 'Main' })
      // Both are the "Main" navigation with the same links; their root classes are the only way
      // jsdom tells the sidebar from the tab bar.
      expect(nav.closest('.ks-side')).not.toBeNull()
      expect(document.querySelector('.ks-tabbar')).toBeNull()

      await userEvent.click(within(nav).getByRole('link', { name: 'Search' }))
      expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    })

    it('keeps the sidebar while selecting downloads', async () => {
      getMainData.mockResolvedValue({
        rid: 1,
        full_update: true,
        torrents: { dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1 } },
        server_state: {},
      })
      renderApp()
      await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
      expect(screen.getByRole('toolbar', { name: '0 selected' })).toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })

    it('counts the downloads and shows qBittorrent in the sidebar, under a drawer too', async () => {
      getMainData.mockResolvedValue({
        rid: 1,
        full_update: true,
        torrents: {
          dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0 },
          alien: { name: 'Alien.1979.1080p', state: 'stoppedDL', progress: 0.2, size: 1e9, priority: 2 },
        },
        server_state: { dl_info_speed: 4_300_000, up_info_speed: 0, free_space_on_disk: 1e12 },
      })
      renderApp('/torrent/dune')
      await screen.findByRole('dialog', { name: 'Dune.2021.1080p' })
      const nav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(nav).getByRole('link', { name: /^Downloads.*1 downloading$/ })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'qBittorrent' })).toHaveTextContent('qBittorrent v5.2.4')
    })

    it('switches the alternative speed limits from the sidebar, and says when that fails', async () => {
      getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: { use_alt_speed_limits: false } })
      vi.mocked(api.toggleSpeedLimitsMode).mockRejectedValue(new TypeError('Failed to fetch'))
      renderApp('/')
      const status = await screen.findByRole('region', { name: 'qBittorrent' })
      await userEvent.click(await within(status).findByRole('button', { name: 'Alt. speed limits' }))
      expect(api.toggleSpeedLimitsMode).toHaveBeenCalled()
      expect(await screen.findByText('Couldn’t switch the speed limits. Try again.')).toBeInTheDocument()
    })

    it('shows no free space in the sidebar when qBittorrent reports 0, which means it can’t tell', async () => {
      getMainData.mockResolvedValue({
        rid: 1,
        full_update: true,
        torrents: {},
        server_state: { dl_info_speed: 4_300_000, up_info_speed: 0, free_space_on_disk: 0 },
      })
      renderApp('/settings')
      const card = await screen.findByRole('region', { name: 'qBittorrent' })
      await waitFor(() => expect(card).toHaveTextContent('4.3 MB/s'))
      expect(card).not.toHaveTextContent(/free/i)
    })

    describe('a torrent opened from the title page', () => {
      const dune = {
        name: 'Dune.Part.Two.2024.2160p.WEB-DL',
        state: 'downloading',
        progress: 0.5,
        size: 1e9,
        priority: 1,
        ratio: 0,
        tags: 'tmdb:movie:693134',
      } as const

      beforeEach(() => {
        getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { dune }, server_state: {} })
        vi.mocked(tmdb.getMovie).mockResolvedValue({
          id: 693134,
          title: 'Dune: Part Two',
          original_title: 'Dune: Part Two',
          release_date: '2024-02-27',
          poster_path: null,
          genres: [],
        } as unknown as tmdb.MovieDetails)
      })

      /** The title page, then the drawer opened from its "In downloads" card. */
      async function openFromTitle() {
        renderApp('/title/movie/693134')
        const block = await screen.findByRole('region', { name: 'In downloads' })
        const card = within(block).getByRole('link', { name: /Dune\.Part\.Two/ })
        await userEvent.click(card)
        const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
        return { card, drawer }
      }

      it('opens the drawer over the title page and goes back to it on Escape', async () => {
        const { card, drawer } = await openFromTitle()
        expect(where()).toBe('/torrent/dune')
        expect(screen.getByRole('heading', { name: 'Dune: Part Two', level: 1 })).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'Downloads' })).not.toBeInTheDocument()
        const nav = screen.getByRole('navigation', { name: 'Main' })
        expect(within(nav).getByRole('link', { name: /^Downloads/ })).not.toHaveClass('is-on')

        fireEvent(drawer, new Event('cancel', { cancelable: true }))
        expect(await screen.findByText('/title/movie/693134')).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        // The same card, so the page stayed mounted under the drawer.
        expect(card).toHaveFocus()
      })

      it('closes the drawer for the page of the title it is over', async () => {
        const { drawer } = await openFromTitle()
        await userEvent.click(within(drawer).getByRole('button', { name: 'More actions: Dune: Part Two' }))
        await userEvent.click(within(drawer).getByRole('menuitem', { name: 'Movie page' }))
        expect(where()).toBe('/title/movie/693134')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('stays on the title page after deleting, without the torrent', async () => {
        const { drawer } = await openFromTitle()
        getMainData.mockResolvedValue({ rid: 2, full_update: true, torrents: {}, server_state: {} })
        await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
        const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
        await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
        expect(api.deleteTorrents).toHaveBeenCalledWith(['dune'], false)
        expect(await screen.findByText('/title/movie/693134')).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'In downloads' })).not.toBeInTheDocument())
      })

      it('puts the title page in place of a restored drawer with nothing to go back to', async () => {
        const background = { pathname: '/title/movie/693134', search: '', hash: '', state: null, key: 'title' }
        renderApp({ pathname: '/torrent/dune', state: { background } })
        await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
        expect(where()).toBe('/title/movie/693134')
        expect(screen.getByRole('heading', { name: 'Dune: Part Two', level: 1 })).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('switches to the tab bar when the window gets narrow', async () => {
      const resize = stubDesktop()
      renderApp()
      const nav = await screen.findByRole('navigation', { name: 'Main' })
      expect(nav.closest('.ks-side')).not.toBeNull()

      act(() => resize(false))
      expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('ks-tabbar')
    })
  })

  it('shows a torrent as a screen of its own on a phone', async () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: { dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0 } },
      server_state: {},
    })
    renderApp('/torrent/dune')
    expect(await screen.findByRole('heading', { name: 'Dune.2021.1080p', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Downloads' })).not.toBeInTheDocument()
  })

  it('says how a move went after the torrent’s screen was left while it was being sent', async () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: {
        dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0, save_path: '/downloads', added_on: 1 },
      },
      server_state: {},
    })
    vi.mocked(api.getSaveLocations).mockResolvedValue({ defaultPath: '/downloads', categories: [], categoryPaths: false, subcategories: false })
    let fail = (_error: unknown) => {}
    vi.mocked(api.setTorrentLocation).mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    renderApp('/torrent/dune')
    await userEvent.click(await screen.findByRole('button', { name: /^More actions/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move files…' }))
    const sheet = screen.getByRole('dialog', { name: 'Move files' })
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, '/media/new')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
    fail(new api.QbittorrentError('conflict', 409))
    expect(await screen.findByText('qBittorrent couldn’t create that folder.')).toBeInTheDocument()
  })

  it('asks for the TMDB key when the server has none, then goes in', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Connect TMDB' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open TMDB API settings' })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/settings/api',
    )
    await userEvent.type(screen.getByLabelText('API key or read access token'), ' abc123 ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(serverSettings.saveTmdbKey).toHaveBeenCalledWith('abc123')
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('shows why a TMDB key was refused', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockRejectedValue(new serverSettings.SettingsError(422, 'invalid-key'))
    renderApp()

    await userEvent.type(await screen.findByLabelText('API key or read access token'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('TMDB didn’t accept this key')).toBeInTheDocument()
    expect(screen.getByLabelText('API key or read access token')).toHaveAttribute('aria-invalid', 'true')
  })

  it('lets the TMDB key wait', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('goes in when the server can’t say whether it has a TMDB key', async () => {
    vi.mocked(serverSettings.getServerSettings).mockRejectedValue(new serverSettings.SettingsError(404))
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('sends unknown paths to downloads', async () => {
    renderApp('/nowhere')
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('returns to sign-in when the session expires while polling', async () => {
    getAppVersion.mockReset().mockResolvedValueOnce('v5.2.4').mockRejectedValue(new api.UnauthorizedError())
    getMainData.mockRejectedValue(new api.UnauthorizedError())
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect qBittorrent' })).toBeInTheDocument()
  })

  it('shows the sign-in form without a session', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect qBittorrent' })).toBeInTheDocument()
  })

  it('switches the theme on the root element', async () => {
    renderApp('/settings')
    await userEvent.click(await screen.findByRole('radio', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switches the language and remembers it', async () => {
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Language' })).getByRole('radio', { name: 'Русский' }))
    expect(screen.getByRole('heading', { name: 'Настройки', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Светлая' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(localStorage.getItem('kinoseed.language')).toBe('ru')
  })
})
