import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as auth from '../api/auth'
import * as matches from '../api/matches'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as serverSettings from '../api/settings'
import * as tmdb from '../api/tmdb'
import i18n from '../i18n'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { TAB_RETURN, forgetTabPlaces, saveTabPlace } from '../lib/tabPlaces'
import { sharedRequests } from '../logic/sharedRequests'
import { getSettings, resetSettings } from '../settings/settings'
import { TELEGRAM_TOKEN } from '../test/fixtures'
import { findToastOnPage, renderWithRouter, saying } from '../test/render'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getAppVersion: vi.fn(),
  getCategories: vi.fn(),
}))
vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  signOut: vi.fn(),
  changePassword: vi.fn(),
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
  checkTelegram: vi.fn(),
  saveTelegramToken: vi.fn(),
  testTelegram: vi.fn(),
  forgetTelegram: vi.fn(),
  findTelegramChat: vi.fn(),
  saveTelegramChat: vi.fn(),
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
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: null,
  })
  vi.mocked(serverSettings.saveDownloadDefaults).mockResolvedValue({
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: {},
  })
})

describe('SettingsScreen', () => {
  it('checks every connection when it opens', async () => {
    renderScreen()
    for (const name of ['qBittorrent', 'Prowlarr', 'TMDB']) {
      expect(await within(connection(name)).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    }
  })

  it('takes the page’s fresh answers for the server’s settings and qBittorrent’s check, which Test asks again (#382)', async () => {
    sharedRequests.set(qbt.APP_VERSION_KEY, '5.2.0')
    sharedRequests.set(serverSettings.SERVER_SETTINGS_KEY, {
      tmdb: { configured: true, source: 'shared', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
    } satisfies serverSettings.ServerSettings)
    renderScreen()
    // From the first render, with nothing asked.
    expect(within(connection('qBittorrent')).getByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    expect(aboutRow('qBittorrent version')).toHaveTextContent(/5\.2\.0$/)
    // The kept settings say TMDB's key is Kinopeer's.
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
    // The categories follow the check that was in.
    expect(await within(screen.getByRole('combobox', { name: 'Movies category' })).findByRole('option', { name: 'Anime' })).toBeInTheDocument()
    expect(qbt.getAppVersion).not.toHaveBeenCalled()
    expect(serverSettings.getServerSettings).not.toHaveBeenCalled()

    await userEvent.click(within(connection('qBittorrent')).getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(aboutRow('qBittorrent version')).toHaveTextContent(/5\.3\.0$/))
    expect(qbt.getAppVersion).toHaveBeenCalledTimes(1)
  })

  it('asks the server’s settings itself once the page’s answer is a minute old', async () => {
    const shared: serverSettings.ServerSettings = {
      tmdb: { configured: true, source: 'shared', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
    }
    const first = renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })).toBeInTheDocument()
    first.unmount()

    vi.mocked(serverSettings.getServerSettings).mockClear().mockResolvedValue(shared)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + serverSettings.SERVER_SETTINGS_FRESH_MS)
    renderScreen()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
    expect(serverSettings.getServerSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the loaded categories through a Test, asking for them only once', async () => {
    renderScreen()
    const movies = screen.getByRole('combobox', { name: 'Movies category' })
    expect(await within(movies).findByRole('option', { name: 'Anime' })).toBeInTheDocument()

    await userEvent.click(within(connection('qBittorrent')).getByRole('button', { name: 'Test' }))
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying(/^Connected/) })).toBeInTheDocument()
    expect(within(movies).getByRole('option', { name: 'Anime' })).toBeInTheDocument()
    expect(qbt.getCategories).toHaveBeenCalledTimes(1)
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

  it('says when Prowlarr or TMDB doesn’t answer its check', async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockRejectedValue(new TypeError('Failed to fetch'))
    vi.mocked(tmdb.checkTmdb).mockRejectedValue(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await within(connection('Prowlarr')).findByRole('status', { name: saying('Prowlarr isn’t answering') })).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('TMDB isn’t answering') })).toBeInTheDocument()
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
    const shared = { tmdb: { configured: true, source: 'shared', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null } as const
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
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null } as const
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
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'shared' }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null } as const
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
    const saved = { tmdb: { configured: true, source: 'saved', fallback: 'env' }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null } as const
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
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: status, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null })
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
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null })
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
    vi.mocked(serverSettings.saveProwlarrKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'saved', serverKey: true, address: { source: 'env' } }, qbittorrent: { configured: true, source: 'env', address: { source: 'env' } }, downloads: null })
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
      prowlarr: { configured: true, source: 'saved', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
    })
    vi.mocked(serverSettings.forgetProwlarrKey).mockResolvedValue({
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
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
      prowlarr: { configured: true, source: 'saved', serverKey: false, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
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

  it.each([
    ['as on Umbrel', { auth: { enabled: false } }],
    ['with a server before it', {}],
  ] as const)('has no sign-in section without Kinopeer’s own login, %s', async (_, login) => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
      tmdb: { configured: true, source: 'shared', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
      ...login,
    })
    renderScreen()
    // Something only the settings answer shows: it's in.
    expect(await within(connection('TMDB')).findByRole('status', { name: saying('Connected · Kinopeer’s key') })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sign-in' })).not.toBeInTheDocument()
  })

  it('shows its sign-in section from the first render with the page’s answer gone stale, while it asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    sharedRequests.set(serverSettings.SERVER_SETTINGS_KEY, {
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
      auth: { enabled: true, source: 'saved' },
    } satisfies serverSettings.ServerSettings)
    vi.setSystemTime(Date.now() + serverSettings.SERVER_SETTINGS_FRESH_MS + 1)
    vi.mocked(serverSettings.getServerSettings).mockReturnValue(new Promise(() => {}))
    renderScreen()
    // Whether the login is on is the server's environment's, so an older answer still says it,
    // and the section isn't added under the rows once the new one comes (a layout shift).
    expect(screen.getByRole('region', { name: 'Sign-in' })).toBeInTheDocument()
    await waitFor(() => expect(serverSettings.getServerSettings).toHaveBeenCalled())
  })

  it('changes Kinopeer’s password in a sheet and says the other devices are signed out', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ ...(await serverSettings.getServerSettings()), auth: { enabled: true, source: 'saved' } })
    vi.mocked(auth.changePassword).mockResolvedValue()
    renderScreen()
    const section = await screen.findByRole('region', { name: 'Sign-in' })
    expect(within(section).queryByText(/KINOPEER_PASSWORD/)).not.toBeInTheDocument()
    const change = within(section).getByRole('button', { name: /^Change password/ })
    expect(within(change).getByText('Change password')).toBeInTheDocument()
    expect(within(change).getByText('Other devices will need to sign in again')).toBeInTheDocument()
    // Closed without changing anything.
    await userEvent.click(change)
    fireEvent(screen.getByRole('dialog', { name: 'Change password' }), new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change password' })).not.toBeInTheDocument())
    expect(auth.changePassword).not.toHaveBeenCalled()

    await userEvent.click(change)

    const sheet = screen.getByRole('dialog', { name: 'Change password' })
    await userEvent.type(within(sheet).getByLabelText('Current password'), 'correct horse')
    await userEvent.type(within(sheet).getByLabelText('New password'), 'battery staple')
    await userEvent.type(within(sheet).getByLabelText('Repeat the password'), 'battery staple')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Change password' }))

    expect(auth.changePassword).toHaveBeenCalledExactlyOnceWith('correct horse', 'battery staple')
    expect(await findToastOnPage('Password changed. Other devices will need to sign in again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change password' })).not.toBeInTheDocument())
  })

  it('says a password from KINOPEER_PASSWORD is changed on the server, and still signs out', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ ...(await serverSettings.getServerSettings()), auth: { enabled: true, source: 'env' } })
    vi.mocked(auth.signOut).mockResolvedValue()
    renderScreen()
    const section = await screen.findByRole('region', { name: 'Sign-in' })
    expect(within(section).queryByRole('button', { name: /^Change password/ })).not.toBeInTheDocument()
    expect(within(section).getByText('The password is set on the server (KINOPEER_PASSWORD), so it’s changed there.')).toBeInTheDocument()

    const signOut = within(section).getByRole('button', { name: /^Sign out/ })
    expect(within(signOut).getByText('Sign out')).toBeInTheDocument()
    expect(within(signOut).getByText('On this device')).toBeInTheDocument()
    await userEvent.click(signOut)
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('says when signing out failed', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ ...(await serverSettings.getServerSettings()), auth: { enabled: true, source: 'saved' } })
    vi.mocked(auth.signOut).mockRejectedValue(new auth.AuthError(502))
    renderScreen()
    const section = await screen.findByRole('region', { name: 'Sign-in' })
    await userEvent.click(within(section).getByRole('button', { name: /^Sign out/ }))
    expect(await findToastOnPage('Couldn’t sign out. Try again.')).toBeInTheDocument()
  })

  it.each([
    ['changing the password', async (section: HTMLElement) => {
      vi.mocked(auth.changePassword).mockRejectedValue(new auth.AuthError(409, 'auth-off'))
      await userEvent.click(within(section).getByRole('button', { name: /^Change password/ }))
      const sheet = screen.getByRole('dialog', { name: 'Change password' })
      await userEvent.type(within(sheet).getByLabelText('Current password'), 'correct horse')
      await userEvent.type(within(sheet).getByLabelText('New password'), 'battery staple')
      await userEvent.type(within(sheet).getByLabelText('Repeat the password'), 'battery staple')
      await userEvent.click(within(sheet).getByRole('button', { name: 'Change password' }))
    }],
    ['signing out', async (section: HTMLElement) => {
      vi.mocked(auth.signOut).mockRejectedValue(new auth.AuthError(409, 'auth-off'))
      await userEvent.click(within(section).getByRole('button', { name: /^Sign out/ }))
    }],
  ])('drops the Sign-in section when the server turned its login off since Settings opened (%s)', async (_, use) => {
    const settings = { ...(await serverSettings.getServerSettings()), auth: { enabled: true, source: 'saved' } as const }
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings)
    renderScreen()
    await use(await screen.findByRole('region', { name: 'Sign-in' }))

    expect(await findToastOnPage('Kinopeer’s sign-in was turned off on the server.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sign-in' })).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Change password' })).not.toBeInTheDocument()
    expect(screen.queryByText('Couldn’t sign out. Try again.')).not.toBeInTheDocument()
    // The page's answer says so too, so Settings opened again doesn't offer the section.
    expect(sharedRequests.peek(serverSettings.SERVER_SETTINGS_KEY, Infinity)?.data).toEqual({ ...settings, auth: { enabled: false } })
  })

  it('keeps no answer of its own when the login was turned off while the page’s next answer is on its way', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const stale = {
      tmdb: { configured: true, source: 'saved', fallback: null },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
      auth: { enabled: true, source: 'saved' },
    } satisfies serverSettings.ServerSettings
    sharedRequests.set(serverSettings.SERVER_SETTINGS_KEY, stale)
    vi.setSystemTime(Date.now() + serverSettings.SERVER_SETTINGS_FRESH_MS + 1)
    let answer: (settings: serverSettings.ServerSettings) => void = () => {}
    vi.mocked(serverSettings.getServerSettings).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    vi.mocked(auth.signOut).mockRejectedValue(new auth.AuthError(409, 'auth-off'))
    renderScreen()
    await userEvent.click(within(screen.getByRole('region', { name: 'Sign-in' })).getByRole('button', { name: /^Sign out/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sign-in' })).not.toBeInTheDocument())

    // The answer on its way says the login is off itself, and becomes the page's.
    const fresh = { ...stale, auth: { enabled: false } } satisfies serverSettings.ServerSettings
    await act(async () => answer(fresh))
    expect(sharedRequests.peek(serverSettings.SERVER_SETTINGS_KEY, Infinity)?.data).toBe(fresh)
    expect(screen.queryByRole('region', { name: 'Sign-in' })).not.toBeInTheDocument()
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
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying('Kinopeer isn’t answering') })).toBeInTheDocument()
  })

  it('loads the categories when Test finds qBittorrent back', async () => {
    vi.mocked(qbt.getAppVersion).mockRejectedValue(new Error('offline'))
    vi.mocked(qbt.getCategories).mockRejectedValue(new Error('offline'))
    renderScreen()
    expect(await within(connection('qBittorrent')).findByRole('status', { name: saying('qBittorrent isn’t answering') })).toBeInTheDocument()
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
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
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

describe('SettingsScreen: Telegram', () => {
  const settings = (telegram?: serverSettings.TelegramStatus): serverSettings.ServerSettings => ({
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: null,
    telegram,
    notifications: Boolean(telegram?.chat),
  })
  const CONNECTED: serverSettings.TelegramStatus = { bot: 'kinopeer_home_bot', chat: { name: 'Alex', type: 'private' }, refused: null }

  it('has no Telegram card for a server that doesn’t know Telegram', async () => {
    renderScreen()
    await within(connection('TMDB')).findByRole('status', { name: saying('Connected') })
    const connections = screen.getByRole('region', { name: 'Connections' })
    expect(within(connections).queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument()
    expect(within(connections).queryByRole('button', { name: 'Change Telegram notifications' })).not.toBeInTheDocument()
  })

  it('offers to set Telegram up, asking Telegram nothing, and saves a token from its sheet', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings({ bot: null, chat: null, refused: null }))
    vi.mocked(serverSettings.saveTelegramToken).mockResolvedValue(settings({ bot: 'kinopeer_home_bot', chat: null, refused: null }))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    const card = await waitFor(() => connection('Telegram'))
    expect(within(card).getByRole('status')).toHaveTextContent('Not set up. Sends a message when a download finishes.')
    expect(within(card).queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(serverSettings.checkTelegram).not.toHaveBeenCalled()

    await userEvent.click(within(card).getByRole('button', { name: 'Set up' }))
    const sheet = screen.getByRole('dialog', { name: 'Telegram notifications' })
    await userEvent.type(within(sheet).getByLabelText('Bot token'), TELEGRAM_TOKEN)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    // The sheet goes on to the chat, and the card checks the new bot.
    expect(await within(sheet).findByRole('button', { name: 'Find chat' })).toBeInTheDocument()
    expect(await within(connection('Telegram')).findByRole('status', { name: saying('Choose the chat to send to') })).toBeInTheDocument()
    expect(serverSettings.checkTelegram).toHaveBeenCalledTimes(1)
  })

  it('says where notifications go once the check passes, and checks again on Test', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    const status = await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying('Sends to “Alex” from @kinopeer_home_bot') }))
    expect(status).toBeInTheDocument()
    await userEvent.click(within(connection('Telegram')).getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(serverSettings.checkTelegram).toHaveBeenCalledTimes(2))
  })

  it.each([
    ['the token Telegram no longer knows', CONNECTED, new serverSettings.SettingsError(422, 'token-rejected'), 'Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.'],
    ['that Telegram doesn’t answer', CONNECTED, new serverSettings.SettingsError(502, 'unreachable'), 'Telegram isn’t answering'],
  ])('names %s', async (_name, telegram, error, message) => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(telegram))
    vi.mocked(serverSettings.checkTelegram).mockRejectedValue(error)
    renderScreen()
    expect(await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying(message) }))).toBeInTheDocument()
  })

  it('checks again once a renewed token of the same bot is saved', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram)
      .mockRejectedValueOnce(new serverSettings.SettingsError(422, 'token-rejected'))
      .mockResolvedValue({ bot: 'kinopeer_home_bot' })
    vi.mocked(serverSettings.saveTelegramToken).mockResolvedValue(settings(CONNECTED))
    renderScreen()
    const rejected = 'Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.'
    await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying(rejected) }))
    await userEvent.click(within(connection('Telegram')).getByRole('button', { name: 'Change Telegram notifications' }))
    const sheet = screen.getByRole('dialog', { name: 'Telegram notifications' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Use another bot' }))
    await userEvent.type(within(sheet).getByLabelText('Bot token'), TELEGRAM_TOKEN)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(connection('Telegram')).findByRole('status', { name: saying('Sends to “Alex” from @kinopeer_home_bot') })).toBeInTheDocument()
    expect(serverSettings.checkTelegram).toHaveBeenCalledTimes(2)
  })

  it('warns that Telegram refused the chat, so it’s chosen again', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings({ ...CONNECTED, refused: 'chat' }))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    const message = 'Telegram didn’t deliver to “Alex”: the bot was blocked or removed from it. Send the bot /start and choose the chat again.'
    expect(await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying(message) }))).toBeInTheDocument()
  })

  it('shows in the card what Telegram refused when a test message fails', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(new serverSettings.SettingsError(422, 'chat-rejected'))
    renderScreen()
    await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying('Sends to “Alex” from @kinopeer_home_bot') }))
    await userEvent.click(within(connection('Telegram')).getByRole('button', { name: 'Change Telegram notifications' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Telegram notifications' })).getByRole('button', { name: 'Send a test message' }))
    const message = 'Telegram didn’t deliver to “Alex”: the bot was blocked or removed from it. Send the bot /start and choose the chat again.'
    expect(await within(connection('Telegram')).findByRole('status', { name: saying(message) })).toBeInTheDocument()
  })

  it.each([
    ['a chat still to choose', { ...CONNECTED, chat: null }, 'Choose the chat to send to'],
    ['a chat Telegram refused', { ...CONNECTED, refused: 'chat' as const }, 'Telegram didn’t deliver to “Alex”: the bot was blocked or removed from it. Send the bot /start and choose the chat again.'],
  ])('marks %s as a warning', async (_name, telegram, message) => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(telegram))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    const status = await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying(message) }))
    // c-warn is what colors the message as a warning (MESSAGE_CLASS); jsdom has no colors to read.
    expect(status).toHaveClass('c-warn')
  })

  it('doesn’t mark a working chat as a warning', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    const status = await waitFor(() => within(connection('Telegram')).getByRole('status', { name: saying('Sends to “Alex” from @kinopeer_home_bot') }))
    // c-warn is what colors the message as a warning (MESSAGE_CLASS); jsdom has no colors to read.
    expect(status).not.toHaveClass('c-warn')
  })

  it('turns notifications off from the sheet: the sheet closes, a toast says so and the card offers to set up again', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    vi.mocked(serverSettings.forgetTelegram).mockResolvedValue(settings({ bot: null, chat: null, refused: null }))
    renderScreen()
    await userEvent.click(await waitFor(() => within(connection('Telegram')).getByRole('button', { name: 'Change Telegram notifications' })))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Telegram notifications' })).getByRole('button', { name: 'Turn off' }))
    expect(await findToastOnPage('Telegram notifications are off')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Telegram notifications' })).not.toBeInTheDocument()
    expect(within(connection('Telegram')).getByRole('status')).toHaveTextContent('Not set up. Sends a message when a download finishes.')
    expect(within(connection('Telegram')).getByRole('button', { name: 'Set up' })).toBeInTheDocument()
  })

  it.each([
    ['saving the token', { bot: null, chat: null, refused: null }, 'Set up', 'Choose the chat to send to'],
    ['saving the chat', { bot: 'kinopeer_home_bot', chat: null, refused: null }, 'Change Telegram notifications', 'Sends to “Alex” from @kinopeer_home_bot'],
    ['sending a test message', { ...CONNECTED, refused: 'chat' }, 'Change Telegram notifications', 'Sends to “Alex” from @kinopeer_home_bot'],
  ] as const)('updates the card when %s settles after the sheet was closed', async (step, telegram, open, message) => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(telegram))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValue({ id: 42, name: 'Alex', type: 'private' })
    let answer!: (saved: serverSettings.ServerSettings) => void
    const answered = new Promise<serverSettings.ServerSettings>((resolve) => (answer = resolve))
    vi.mocked(serverSettings.saveTelegramToken).mockReturnValue(answered)
    vi.mocked(serverSettings.saveTelegramChat).mockReturnValue(answered)
    vi.mocked(serverSettings.testTelegram).mockReturnValue(answered)
    renderScreen()
    await userEvent.click(await waitFor(() => within(connection('Telegram')).getByRole('button', { name: open })))
    const sheet = screen.getByRole('dialog', { name: 'Telegram notifications' })
    if (step === 'saving the token') {
      await userEvent.type(within(sheet).getByLabelText('Bot token'), TELEGRAM_TOKEN)
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    } else if (step === 'saving the chat') {
      await userEvent.click(within(sheet).getByRole('button', { name: 'Find chat' }))
      await userEvent.click(await within(sheet).findByRole('button', { name: 'Use this chat' }))
    } else {
      await userEvent.click(within(sheet).getByRole('button', { name: 'Send a test message' }))
    }
    await userEvent.click(sheet)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Telegram notifications' })).not.toBeInTheDocument())
    answer(settings(step === 'saving the token' ? { bot: 'kinopeer_home_bot', chat: null, refused: null } : CONNECTED))
    expect(await within(connection('Telegram')).findByRole('status', { name: saying(message) })).toBeInTheDocument()
  })

  it('closes the sheet on a click on its backdrop', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    await userEvent.click(await waitFor(() => within(connection('Telegram')).getByRole('button', { name: 'Change Telegram notifications' })))
    const sheet = screen.getByRole('dialog', { name: 'Telegram notifications' })
    await userEvent.click(sheet)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Telegram notifications' })).not.toBeInTheDocument())
  })

  it('gives a card without an edit action no edit button', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue(settings(CONNECTED))
    vi.mocked(serverSettings.checkTelegram).mockResolvedValue({ bot: 'kinopeer_home_bot' })
    renderScreen()
    await within(connection('qBittorrent')).findByRole('status', { name: saying('Connected') })
    expect(within(connection('qBittorrent')).getAllByRole('button').map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Test'])
  })
})

