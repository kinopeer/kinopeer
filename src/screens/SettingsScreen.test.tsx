import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matches from '../api/matches'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as serverSettings from '../api/settings'
import * as tmdb from '../api/tmdb'
import i18n from '../i18n'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { TAB_RETURN, forgetTabPlaces, saveTabPlace } from '../lib/tabPlaces'
import { getSettings, resetSettings } from '../settings/settings'
import { findToastOnPage, renderWithRouter, saying } from '../test/render'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getAppVersion: vi.fn(),
  getCategories: vi.fn(),
}))
vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matches>()),
  clearGuesses: vi.fn(),
}))
vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  getProwlarrStatus: vi.fn(),
}))
vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  getServerSettings: vi.fn(),
  saveTmdbKey: vi.fn(),
  saveProwlarrKey: vi.fn(),
  forgetProwlarrKey: vi.fn(),
  forgetTmdbKey: vi.fn(),
  saveDownloadDefaults: vi.fn(),
}))
vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  checkTmdb: vi.fn(),
}))

function renderScreen(state?: unknown) {
  return renderWithRouter(<SettingsScreen />, [{ pathname: '/settings', state }])
}

function connection(name: string) {
  return within(screen.getByRole('region', { name: 'Connections' }))
    .getByText(name)
    .closest('li') as HTMLElement
}

function aboutRow(label: string) {
  return within(screen.getByRole('region', { name: 'About' }))
    .getByText(label)
    .closest('li') as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(qbt.getAppVersion).mockResolvedValue('5.3.0')
  vi.mocked(qbt.getCategories).mockResolvedValue([
    { name: 'TV Shows', savePath: '/data/tv' },
    { name: 'Movies', savePath: '/data/movies' },
    { name: 'Anime', savePath: '' },
  ])
  vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 2 })
  vi.mocked(tmdb.checkTmdb).mockResolvedValue()
  vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true },
    qbittorrent: { configured: true, source: 'env' },
    downloads: null,
  })
  vi.mocked(serverSettings.saveDownloadDefaults).mockResolvedValue({
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true },
    qbittorrent: { configured: true, source: 'env' },
    downloads: {},
  })
})

afterEach(() => {
  // The user agent spy, even when its test fails.
  vi.restoreAllMocks()
})

describe('SettingsScreen', () => {
  it('checks every connection when it opens', async () => {
    renderScreen()
    for (const name of ['qBittorrent', 'Prowlarr', 'TMDB']) {
      expect(await within(connection(name)).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    }
  })

  it('comes back through the Settings tab to where the tab was left, without waiting for its checks', async () => {
    // Nothing kept for the entry itself, which every test's router calls "default".
    sessionStorage.clear()
    forgetTabPlaces()
    saveTabPlace('/settings', { search: '', y: 500 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.mocked(qbt.getAppVersion).mockReturnValue(new Promise(() => {}))
    renderScreen(TAB_RETURN)
    expect(scrollTo).toHaveBeenCalledWith(0, 500)
  })

  it('warns that Prowlarr has no indexers, since search finds nothing then', async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 0 })
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Connected · no indexers') })).toBeInTheDocument()
    expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/0$/)
  })

  it('explains failures and shows the service connected after Test', async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockRejectedValue(new prowlarr.ProwlarrSetupError(502, 'unauthorized'))
    vi.mocked(tmdb.checkTmdb).mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Not set up, or the API key was rejected') })).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('The API key is missing or invalid') })).toBeInTheDocument()

    // About has nothing to show for a service that fails, and says nothing of why.
    expect(aboutRow('Prowlarr version')).toHaveTextContent(/^Prowlarr version—Unknown$/)
    expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/^Prowlarr indexers—Unknown$/)

    vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 1 })
    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Test' }))
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    // About shows what Test's check answered.
    expect(aboutRow('Prowlarr version')).toHaveTextContent(/1\.24\.3$/)
    expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/1$/)
  })

  it.each([
    { name: 'qBittorrent', called: [qbt.getAppVersion] },
    { name: 'Prowlarr', called: [prowlarr.getProwlarrStatus] },
    { name: 'TMDB', called: [tmdb.checkTmdb] },
  ])('checks only $name again on its Test', async ({ name, called }) => {
    // Loaded categories aren't asked again either, so the selects don't empty for a moment.
    const checks = [qbt.getAppVersion, qbt.getCategories, prowlarr.getProwlarrStatus, tmdb.checkTmdb]
    renderScreen()
    for (const row of ['qBittorrent', 'Prowlarr', 'TMDB']) {
      expect(await within(connection(row)).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    }
    expect(await within(screen.getByRole('combobox', { name: 'Movies category' })).findByRole('option', { name: 'Anime' })).toBeInTheDocument()
    for (const fn of checks) vi.mocked(fn).mockClear()

    await userEvent.click(within(connection(name)).getByRole('button', { name: 'Test' }))
    expect(await within(connection(name)).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    for (const fn of checks) expect(fn).toHaveBeenCalledTimes(called.some((c) => c === fn) ? 1 : 0)
  })

  it("can't Test a service while it is being checked", async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockReturnValue(new Promise(() => {}))
    renderScreen()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    expect(within(connection('Prowlarr')).getByRole('status', { name: saying('Checking…') })).toBeInTheDocument()
    expect(within(connection('Prowlarr')).getByRole('button', { name: 'Test' })).toBeDisabled()
    expect(within(connection('qBittorrent')).getByRole('button', { name: 'Test' })).toBeEnabled()
  })

  it('cancels the checks still running when the screen closes', async () => {
    const running = new Promise<never>(() => {})
    vi.mocked(qbt.getAppVersion).mockReturnValue(running)
    vi.mocked(prowlarr.getProwlarrStatus).mockReturnValue(running)
    vi.mocked(tmdb.checkTmdb).mockReturnValue(running)
    const { unmount } = renderScreen()
    const checks = [qbt.getAppVersion, prowlarr.getProwlarrStatus, tmdb.checkTmdb]
    await waitFor(() => {
      for (const check of checks) expect(vi.mocked(check).mock.lastCall?.[0]?.aborted).toBe(false)
    })

    unmount()
    for (const check of checks) expect(vi.mocked(check).mock.lastCall?.[0]?.aborted).toBe(true)
  })

  it('cancels loading the categories when the screen closes', async () => {
    vi.mocked(qbt.getCategories).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderScreen()
    await waitFor(() => expect(vi.mocked(qbt.getCategories).mock.lastCall?.[0]?.aborted).toBe(false))

    unmount()
    expect(vi.mocked(qbt.getCategories).mock.lastCall?.[0]?.aborted).toBe(true)
  })

  it('says Kinopeer’s key is used, offers the user’s own, and drops the mention once it’s saved', async () => {
    const shared = { tmdb: { configured: true, source: 'shared', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null } as const
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(shared)
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ ...shared, tmdb: { configured: true, source: 'saved', fallback: null } })
    renderScreen()

    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Use your own TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    await userEvent.type(within(sheet).getByLabelText('API key or read access token'), 'abc123')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    expect(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' })).toBeInTheDocument()
  })

  it('goes back from a saved TMDB key to Kinopeer’s and checks the connection again', async () => {
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null } as const
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(saved)
    vi.mocked(serverSettings.forgetTmdbKey).mockResolvedValue({ ...saved, tmdb: { configured: true, source: 'shared', fallback: 'shared' } })
    renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    vi.mocked(tmdb.checkTmdb).mockClear()

    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Use Kinopeer’s key' }))

    expect(await findToastOnPage('Using Kinopeer’s TMDB key')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying('TMDB key saved') })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'TMDB key' })).not.toBeInTheDocument()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
    expect(within(connection('TMDB')).getByRole('button', { name: 'Use your own TMDB key' })).toBeInTheDocument()
    expect(tmdb.checkTmdb).toHaveBeenCalledTimes(1)
  })

  it('goes back to Kinopeer’s TMDB key when the sheet was closed before the answer', async () => {
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null } as const
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(saved)
    let finish = (_settings: serverSettings.ServerSettings) => {}
    vi.mocked(serverSettings.forgetTmdbKey).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()

    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Use Kinopeer’s key' }))
    // Escape: the browser cancels the modal <dialog>, which jsdom doesn't do on a key press.
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'TMDB key' })).not.toBeInTheDocument())

    act(() => finish({ ...saved, tmdb: { configured: true, source: 'shared', fallback: 'shared' } }))

    expect(await findToastOnPage('Using Kinopeer’s TMDB key')).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
  })

  it('goes back to the server’s TMDB key when it has TMDB_API_KEY', async () => {
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'env' }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null } as const
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(saved)
    vi.mocked(serverSettings.forgetTmdbKey).mockResolvedValue({ ...saved, tmdb: { configured: true, source: 'env', fallback: 'env' } })
    renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()

    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    await userEvent.click(await within(screen.getByRole('dialog', { name: 'TMDB key' })).findByRole('button', { name: 'Use the server’s key' }))

    expect(await findToastOnPage('Using the server’s TMDB key')).toBeInTheDocument()
    expect(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' })).toBeInTheDocument()
  })

  it.each([
    ['nothing to fall back on', { configured: true, source: 'saved', fallback: null }],
    ['the key in use is the server’s', { configured: true, source: 'env', fallback: 'env' }],
  ] as const)('doesn’t offer to forget the TMDB key with %s', async (_name, status) => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: status, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderScreen()
    // Let the settings load, so the button's absence isn't only the moment before they arrive.
    await waitFor(() => expect(serverSettings.getServerSettings).toHaveBeenCalled())
    await act(() => Promise.all(vi.mocked(serverSettings.getServerSettings).mock.results.map((result) => result.value)))

    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    expect(within(sheet).getByLabelText('API key or read access token')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Use .* key$/ })).not.toBeInTheDocument()
  })

  it('changes the TMDB key and checks the connection again', async () => {
    vi.mocked(tmdb.checkTmdb).mockRejectedValue(new tmdb.TmdbKeyError(401))
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('The API key is missing or invalid') })).toBeInTheDocument()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying(/^Connected/) })).toBeInTheDocument()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying(/^Connected/) })).toBeInTheDocument()
    vi.mocked(qbt.getAppVersion).mockClear()
    vi.mocked(prowlarr.getProwlarrStatus).mockClear()

    vi.mocked(tmdb.checkTmdb).mockResolvedValue()
    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    await userEvent.type(within(sheet).getByLabelText('API key or read access token'), 'abc123')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(serverSettings.saveTmdbKey).toHaveBeenCalledWith('abc123')
    expect(await findToastOnPage('TMDB key saved')).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    expect(qbt.getAppVersion).not.toHaveBeenCalled()
    expect(prowlarr.getProwlarrStatus).not.toHaveBeenCalled()
  })

  it('changes the Prowlarr key and checks the connection again', async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockRejectedValue(new prowlarr.ProwlarrSetupError(503, 'not-configured'))
    vi.mocked(serverSettings.saveProwlarrKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'saved', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Not set up, or the API key was rejected') })).toBeInTheDocument()

    vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 2 })
    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Change Prowlarr key' }))
    const sheet = screen.getByRole('dialog', { name: 'Prowlarr key' })
    await userEvent.type(within(sheet).getByLabelText('Prowlarr API key'), 'abc123')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await findToastOnPage('Prowlarr key saved')).toBeInTheDocument()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()

    // The settings the save answered with are what the sheet goes by now, without loading them again.
    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Change Prowlarr key' }))
    expect(within(screen.getByRole('dialog', { name: 'Prowlarr key' })).getByRole('button', { name: 'Use the server’s key' })).toBeInTheDocument()
  })

  it("goes back from a saved Prowlarr key to the server's and checks the connection again", async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'saved', serverKey: true },
      qbittorrent: { configured: true, source: 'env' },
      downloads: null,
    })
    vi.mocked(serverSettings.forgetProwlarrKey).mockResolvedValue({
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true },
      qbittorrent: { configured: true, source: 'env' },
      downloads: null,
    })
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/2$/)

    vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 1 })
    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Change Prowlarr key' }))
    const sheet = screen.getByRole('dialog', { name: 'Prowlarr key' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Use the server’s key' }))

    expect(await findToastOnPage('Using the server’s Prowlarr key')).toBeInTheDocument()
    expect(screen.queryByText('Prowlarr key saved')).not.toBeInTheDocument()
    // Checked again with the server's key, which sees another set of indexers.
    await waitFor(() => expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/1$/))
    expect(within(connection('Prowlarr')).getByRole('status', { name: saying('Connected') })).toBeInTheDocument()
  })

  it("doesn't offer the server's Prowlarr key when the server has none", async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'saved', serverKey: false },
      qbittorrent: { configured: true, source: 'env' },
      downloads: null,
    })
    renderScreen()
    // Let the settings load, so the button's absence isn't only the moment before they arrive.
    await waitFor(() => expect(serverSettings.getServerSettings).toHaveBeenCalled())
    await act(() => Promise.all(vi.mocked(serverSettings.getServerSettings).mock.results.map((result) => result.value)))

    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Change Prowlarr key' }))
    const sheet = screen.getByRole('dialog', { name: 'Prowlarr key' })
    expect(within(sheet).getByLabelText('Prowlarr API key')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Use the server’s key' })).not.toBeInTheDocument()
  })

  it("shows the versions of Kinopeer, qBittorrent and Prowlarr and Prowlarr's indexers from the connection checks", async () => {
    renderScreen()
    expect(aboutRow('Kinopeer version')).toHaveTextContent(__APP_VERSION__)
    await waitFor(() => expect(aboutRow('qBittorrent version')).toHaveTextContent(/^qBittorrent version5\.3\.0$/))
    await waitFor(() => expect(aboutRow('Prowlarr version')).toHaveTextContent(/^Prowlarr version1\.24\.3$/))
    expect(aboutRow('Prowlarr indexers')).toHaveTextContent(/^Prowlarr indexers2$/)
    // Asked once, by Connections: About starts no checks of its own.
    expect(qbt.getAppVersion).toHaveBeenCalledTimes(1)
    expect(prowlarr.getProwlarrStatus).toHaveBeenCalledTimes(1)
  })

  it('shows no versions in About while the services are being checked', async () => {
    const running = new Promise<never>(() => {})
    vi.mocked(qbt.getAppVersion).mockReturnValue(running)
    vi.mocked(prowlarr.getProwlarrStatus).mockReturnValue(running)
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Checking…') })).toBeInTheDocument()
    for (const label of ['qBittorrent version', 'Prowlarr version', 'Prowlarr indexers']) {
      expect(aboutRow(label)).toHaveTextContent(new RegExp(`^${label}—Unknown$`))
    }
  })

  it('confirms clearing the cache', async () => {
    vi.mocked(matches.clearGuesses).mockResolvedValue({})
    renderScreen()
    await userEvent.click(screen.getByRole('button', { name: /Clear cache/ }))
    expect(await screen.findByRole('status', { name: saying('Cache cleared') })).toBeInTheDocument()
  })

  it('opens the TMDB key sheet when sent from a screen that needs the key', async () => {
    renderScreen({ editTmdbKey: true })
    expect(screen.getByRole('dialog', { name: 'TMDB key' })).toBeInTheDocument()
  })

  it('saves download defaults', async () => {
    renderScreen()
    const movies = screen.getByRole('combobox', { name: 'Movies category' })
    expect(await within(movies).findByRole('option', { name: 'Automatic (Movies)' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Series category' })).toHaveDisplayValue('Automatic (TV Shows)')

    await userEvent.selectOptions(movies, 'Anime')
    await userEvent.click(screen.getByRole('switch', { name: 'Start paused' }))
    await userEvent.click(screen.getByRole('switch', { name: 'First and last pieces first' }))
    expect(getSettings()).toMatchObject({ movieCategory: 'Anime', startPaused: true, sequential: false, firstLastPieces: true })
    expect(screen.getByText(/the same on every device/)).toBeInTheDocument()
  })

  it('says it’s Kinopeer that doesn’t answer the qBittorrent check when so', async () => {
    vi.mocked(qbt.getAppVersion).mockRejectedValue(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying('No answer from Kinopeer') })).toBeInTheDocument()
  })

  it('loads the categories when Test finds qBittorrent back', async () => {
    vi.mocked(qbt.getAppVersion).mockRejectedValue(new Error('offline'))
    vi.mocked(qbt.getCategories).mockRejectedValue(new Error('offline'))
    renderScreen()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying('No answer from qBittorrent') })).toBeInTheDocument()
    const movies = screen.getByRole('combobox', { name: 'Movies category' })
    expect(movies).toBeDisabled()

    vi.mocked(qbt.getAppVersion).mockResolvedValue('5.3.0')
    vi.mocked(qbt.getCategories).mockResolvedValue([{ name: 'Movies', savePath: '/data/movies' }])
    await userEvent.click(within(connection('qBittorrent')).getByRole('button', { name: 'Test' }))
    expect(await within(movies).findByRole('option', { name: 'Automatic (Movies)' })).toBeInTheDocument()
    expect(movies).toBeEnabled()
  })

  it('loads the categories on a Test pressed while they are still loading and then fail', async () => {
    let fail: (error: Error) => void = () => {}
    vi.mocked(qbt.getCategories).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)))
    renderScreen()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying(/^Connected/) })).toBeInTheDocument()
    await waitFor(() => expect(qbt.getCategories).toHaveBeenCalled())

    await userEvent.click(within(connection('qBittorrent')).getByRole('button', { name: 'Test' }))
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying(/^Connected/) })).toBeInTheDocument()
    await act(async () => fail(new Error('offline')))
    const movies = screen.getByRole('combobox', { name: 'Movies category' })
    expect(await within(movies).findByRole('option', { name: 'Automatic (Movies)' })).toBeInTheDocument()
    expect(movies).toBeEnabled()
  })

  it('says the connections in a new language without checking them again', async () => {
    renderScreen()
    for (const name of ['qBittorrent', 'Prowlarr', 'TMDB']) {
      expect(await within(connection(name)).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    }
    const checks = [qbt.getAppVersion, prowlarr.getProwlarrStatus, tmdb.checkTmdb]
    for (const fn of checks) vi.mocked(fn).mockClear()

    const language = screen.getByRole('radiogroup', { name: 'Language' })
    await userEvent.click(within(language).getByRole('radio', { name: 'Русский' }))
    const connections = screen.getByRole('region', { name: 'Подключения' })
    expect(within(connections).getAllByRole('status', { name: saying('Подключено') })).toHaveLength(3)
    // The checks' answers don't depend on the language, so a new one asks nothing again.
    for (const fn of checks) expect(fn).not.toHaveBeenCalled()
  })

  it("shows the download defaults the server keeps, set on another device", async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true },
      qbittorrent: { configured: true, source: 'env' },
      downloads: { tvCategory: 'Anime', sequential: true, firstLastPieces: true },
    })
    renderScreen()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Sequential download' })).toBeChecked())
    expect(screen.getByRole('switch', { name: 'First and last pieces first' })).toBeChecked()
    // The categories load once qBittorrent's check passes.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Series category' })).toHaveDisplayValue('Anime'))
    expect(screen.getByRole('switch', { name: 'Start paused' })).not.toBeChecked()
  })

  it('chooses the TMDB language', async () => {
    renderScreen()
    const group = screen.getByRole('radiogroup', { name: 'Titles and descriptions' })
    expect(within(group).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: 'Русский' }))
    expect(getSettings().tmdbLanguage).toBe('ru-RU')
  })

  it("follows the browser's language until another language is chosen, and again after System", async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    renderScreen()
    const group = () => screen.getByRole('radiogroup', { name: /^(Language|Язык)$/ })
    expect(within(group()).getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(within(group()).getByRole('radio', { name: 'Русский' }))
    expect(within(group()).getByRole('radio', { name: 'Русский' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(within(group()).getByRole('radio', { name: 'Системный' }))
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(within(group()).getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  })

  it('explains how to add the app to the Dock in Safari on a Mac', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    )
    renderScreen()
    await userEvent.click(screen.getByRole('button', { name: /Install app/ }))
    expect(screen.getByRole('dialog', { name: 'Add to Dock' })).toHaveTextContent('Choose “Add to Dock”')
  })

  it('links to Ideas, a bug report and the source code, each in a new tab and saying so', () => {
    renderScreen()
    const about = screen.getByRole('region', { name: 'About' })
    const links: [RegExp, string][] = [
      [/Suggest an idea.*\(opens in a new tab\)/, IDEAS_URL],
      [/Report a bug.*\(opens in a new tab\)/, BUG_REPORT_URL],
      [/Kinopeer on GitHub.*\(opens in a new tab\)/, REPO_URL],
    ]
    for (const [name, href] of links) {
      const link = within(about).getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
    }
  })

  it('credits TMDB with its logo, and keeps the notice in English on a Russian screen', async () => {
    await i18n.changeLanguage('ru')
    renderScreen()
    const about = screen.getByRole('region', { name: 'О приложении' })
    expect(within(about).getByRole('img', { name: 'TMDB' })).toBeInTheDocument()
    expect(about).toHaveTextContent('Данные о фильмах и сериалах и постеры берутся из TMDB.')
    // The notice's wording is locales.test.ts's; here, that it's marked as English for screen readers.
    expect(within(about).getByText(i18n.t('settings.tmdbNotice'))).toHaveAttribute('lang', 'en')
  })

  it('has no install row where the app can\'t be installed', () => {
    renderScreen()
    expect(screen.queryByRole('button', { name: /Install app/ })).not.toBeInTheDocument()
  })
})
