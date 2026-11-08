import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, type To } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from './api/matches'
import * as prowlarr from './api/prowlarr'
import * as api from './api/qbittorrent'
import * as serverSettings from './api/settings'
import * as tmdb from './api/tmdb'
import App from './App'
import { stubDesktop } from './lib/stubDesktop'
import { forgetTabPlaces } from './lib/tabPlaces'
import { markReloadedFor } from './pwa/updates'
import { findToastOnPage, renderWithRouter, saying, Where, where } from './test/render'

vi.mock('./api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getAppVersion: vi.fn(),
    getCategories: vi.fn(),
    getMainData: vi.fn(),
    getTorrentFiles: vi.fn(),
    deleteTorrents: vi.fn(),
    getSaveLocations: vi.fn(),
    setTorrentLocation: vi.fn(),
    toggleSpeedLimitsMode: vi.fn(),
    stopTorrents: vi.fn(),
  }
})

vi.mock('./api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

vi.mock('./api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  searchReleases: vi.fn(),
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
  // Scroll positions kept by history entry, which every test's router calls "default".
  sessionStorage.clear()
  forgetTabPlaces()
  getAppVersion.mockResolvedValue('5.2.4')
  vi.mocked(api.getCategories).mockResolvedValue([])
  getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: {} })
  const empty = { titles: [], page: 1, totalPages: 1 }
  vi.mocked(tmdb.discoverTitles).mockResolvedValue(empty)
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  vi.mocked(api.getTorrentFiles).mockResolvedValue([])
  vi.mocked(api.deleteTorrents).mockResolvedValue()
  vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const duneDetails = {
  id: 693134,
  title: 'Dune: Part Two',
  original_title: 'Dune: Part Two',
  release_date: '2024-02-27',
  poster_path: null,
  genres: [],
} as unknown as tmdb.MovieDetails

describe('App', () => {
  it('goes straight in when qBittorrent needs no login', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('says the app was updated after reloading for a new version', async () => {
    markReloadedFor(__APP_VERSION__)
    renderApp()
    expect(await findToastOnPage(`Kinopeer updated to ${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('says nothing of an update on an ordinary start', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }))
    // qBittorrent's version, from Settings' check: an answer well after the start, while a toast from it would still show.
    await screen.findByText('5.2.4')
    expect(screen.queryByRole('status', { name: saying(/Kinopeer updated/) })).not.toBeInTheDocument()
  })

  it('navigates between tabs', async () => {
    renderApp()
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Downloads' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(within(nav).getByRole('link', { name: 'Search' }))
    expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByText('5.2.4')).toBeInTheDocument()
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
      // Both are the "Main" navigation with the same links: the root class is what lays one out as the
      // sidebar and the other as the tab bar, and nothing else tells them apart.
      expect(nav.closest('.ks-side')).not.toBeNull()
      expect(document.querySelector('.ks-tabbar')).toBeNull()

      await userEvent.click(within(nav).getByRole('link', { name: 'Search' }))
      expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    })

    it('says in the sidebar when Kinopeer itself stops answering the poll', async () => {
      getMainData.mockRejectedValue(new TypeError('Failed to fetch'))
      renderApp()
      const sidebarStatus = await screen.findByRole('region', { name: 'qBittorrent' })
      expect(await within(sidebarStatus).findAllByText('Kinopeer isn’t answering')).toHaveLength(2)
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
      expect(screen.getByRole('region', { name: 'qBittorrent' })).toHaveTextContent('qBittorrent 5.2.4')
      // The poll's ring, in the card and in the rail, which names the connection in its tooltip.
      const sidebarStatus = screen.getByRole('region', { name: 'qBittorrent' })
      expect(within(sidebarStatus).getAllByRole('img', { name: /^Updated at / })).toHaveLength(2)
      expect(within(sidebarStatus).getByTitle(/^qBittorrent 5\.2\.4 · Updated at /)).toBeInTheDocument()
    })

    // A trailing slash is the same route to React Router, so it has to be the same screen too.
    it.each(['/title/movie/693134', '/title/movie/693134/'])(
      'keeps the title page at %s mounted when Find releases opens its releases',
      async (path) => {
        vi.mocked(tmdb.getMovie).mockResolvedValue(duneDetails)
        vi.mocked(prowlarr.searchReleases).mockResolvedValue([])
        renderApp(path)
        const heading = await screen.findByRole('heading', { name: 'Dune: Part Two', level: 1 })
        await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
        expect(where()).toBe('/title/movie/693134/releases')
        await screen.findByRole('region', { name: 'Releases' })
        // The same heading element: a remounted page would have put a new one in its place.
        expect(heading).toBeInTheDocument()
      },
    )

    it('keeps Downloads mounted, and where it was scrolled, when a torrent opens in the drawer over it', async () => {
      const torrent = { name: 'Dune.Part.Two.2024.2160p.WEB-DL', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0 } as const
      getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { dune: torrent }, server_state: {} })
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      renderApp('/')
      const heading = await screen.findByRole('heading', { name: 'Downloads', level: 1 })
      await userEvent.click(await screen.findByRole('link', { name: /Dune\.Part\.Two/ }))
      expect(await screen.findByRole('dialog', { name: 'Dune.Part.Two.2024.2160p.WEB-DL' })).toBeInTheDocument()
      expect(where()).toBe('/torrent/dune')
      // The same heading element: a remounted screen would have put a new one in its place.
      expect(heading).toBeInTheDocument()
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('clears a crashed screen when the sidebar opens another', async () => {
      // React and the error boundary log the crash; keep the test output clean.
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(tmdb.getMovie).mockResolvedValue({ ...duneDetails, genres: null } as unknown as tmdb.MovieDetails)
      renderApp('/title/movie/693134')
      expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

      await userEvent.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Settings' }))
      expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
    })

    it('clears a crashed title page when another title opens', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(tmdb.getMovie).mockImplementation(async (id) =>
        id === 693134
          ? ({ ...duneDetails, genres: null } as unknown as tmdb.MovieDetails)
          : ({ ...duneDetails, id, title: 'Arrival' } as tmdb.MovieDetails),
      )
      // An address change from outside the crashed screen, as typing a URL or going Back would be.
      renderWithRouter(
        <>
          <App />
          <Link to="/title/movie/329865">Another title</Link>
        </>,
        ['/title/movie/693134'],
      )
      expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('link', { name: 'Another title' }))
      expect(await screen.findByRole('heading', { name: 'Arrival', level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
    })

    it('switches the alternative speed limits from the sidebar, and says when that fails', async () => {
      getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: { use_alt_speed_limits: false } })
      vi.mocked(api.toggleSpeedLimitsMode).mockRejectedValue(new TypeError('Failed to fetch'))
      renderApp('/')
      const status = await screen.findByRole('region', { name: 'qBittorrent' })
      await userEvent.click(await within(status).findByRole('button', { name: 'Alt. speed limits' }))
      expect(api.toggleSpeedLimitsMode).toHaveBeenCalled()
      expect(await screen.findByRole('status', { name: saying('Couldn’t switch the speed limits. Try again.') })).toBeInTheDocument()
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
        vi.mocked(tmdb.getMovie).mockResolvedValue(duneDetails)
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
        // is-on is what highlights the page behind the drawer; aria-current follows the URL, so it
        // can't name that page.
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
        expect(await findToastOnPage('Torrent deleted')).toBeInTheDocument()
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
      // The root class tells the tab bar from the sidebar, as above.
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

  it('opens a torrent from a title page as a screen of its own on a phone, not over the page', async () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: { dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0 } },
      server_state: {},
    })
    vi.mocked(tmdb.getMovie).mockResolvedValue(duneDetails)
    // As the title page's "In downloads" card links to it, on a phone too.
    renderApp({ pathname: '/torrent/dune', state: { background: { pathname: '/title/movie/693134', search: '', hash: '', state: null, key: 'title' } } })
    expect(await screen.findByRole('heading', { name: 'Dune.2021.1080p', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dune: Part Two' })).not.toBeInTheDocument()
  })

  it('opens a torrent’s screen from Downloads at the top on a phone', async () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: { dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0 } },
      server_state: {},
    })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: /Dune\.2021/ }))
    expect(await screen.findByRole('heading', { name: 'Dune.2021.1080p', level: 1 })).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  /** One torrent in qBittorrent, and its folders, for the move steps below. */
  const givenDuneToMove = () => {
    getMainData.mockResolvedValue({
      rid: 1,
      full_update: true,
      torrents: {
        dune: { name: 'Dune.2021.1080p', state: 'downloading', progress: 0.5, size: 1e9, priority: 1, ratio: 0, save_path: '/downloads', added_on: 1 },
      },
      server_state: {},
    })
    vi.mocked(api.getSaveLocations).mockResolvedValue({ defaultPath: '/downloads', categories: [], categoryPaths: false, subcategories: false, relocateOnCategoryChange: true, downloadPath: false })
  }

  it('says how a move went after the torrent’s screen was left while it was being sent', async () => {
    givenDuneToMove()
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
    expect(await screen.findByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
  })

  it('shows a move sent from the torrent’s screen busy in Downloads’ sheet for that torrent, so it isn’t sent twice', async () => {
    givenDuneToMove()
    vi.mocked(api.setTorrentLocation).mockReturnValue(new Promise<void>(() => {}))
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

    // Downloads, another screen, shares the move through App's requests.
    await userEvent.click(await screen.findByRole('button', { name: /^More actions/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move files…' }))
    const again = screen.getByRole('dialog', { name: 'Move files' })
    expect(within(again).getByRole('textbox', { name: 'Folder' })).toHaveValue('/media/new')
    expect(within(again).getByRole('button', { name: /Move/ })).toBeDisabled()
    expect(api.setTorrentLocation).toHaveBeenCalledOnce()
  })

  it('shows a torrent paused as soon as qBittorrent took the pause, before the poll it asks for answers', async () => {
    givenDuneToMove()
    vi.mocked(api.stopTorrents).mockResolvedValue()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: /^More actions/ }))
    getMainData.mockReturnValue(new Promise(() => {}))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause' }))
    // App's requests are linked to its poll: they asked it again and show the state meanwhile.
    expect(await within(screen.getByRole('listitem')).findByText('Paused')).toBeInTheDocument()
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('asks for the TMDB key when the server has none, then goes in', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null, fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
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
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null, fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockRejectedValue(new serverSettings.SettingsError(422, 'invalid-key'))
    renderApp()

    await userEvent.type(await screen.findByLabelText('API key or read access token'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('TMDB didn’t accept this key')).toBeInTheDocument()
    expect(screen.getByLabelText('API key or read access token')).toHaveAttribute('aria-invalid', 'true')
  })

  it('lets the TMDB key wait', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null, fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
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
    getAppVersion.mockReset().mockResolvedValueOnce('5.2.4').mockRejectedValue(new api.UnauthorizedError())
    getMainData.mockRejectedValue(new api.UnauthorizedError())
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect qBittorrent' })).toBeInTheDocument()
  })

  it('says Kinopeer isn’t answering when the session check gets no answer from it', async () => {
    getAppVersion.mockRejectedValue(new TypeError('Failed to fetch'))
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
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
    expect(localStorage.getItem('kinopeer.language')).toBe('ru')
  })
})
