import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matches from '../api/matches'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as serverSettings from '../api/settings'
import * as tmdb from '../api/tmdb'
import i18n from '../i18n'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { getSettings, resetSettings } from '../settings/settings'
import { renderWithRouter } from '../test/render'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getAppVersion: vi.fn(),
  getApiVersion: vi.fn(),
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
  saveDownloadDefaults: vi.fn(),
}))
vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  checkTmdb: vi.fn(),
}))

function renderScreen(state?: unknown) {
  renderWithRouter(<SettingsScreen />, [{ pathname: '/settings', state }])
}

function connection(name: string) {
  return within(screen.getByRole('region', { name: 'Connections' }))
    .getByText(name)
    .closest('li') as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(qbt.getAppVersion).mockResolvedValue('v5.3.0')
  vi.mocked(qbt.getApiVersion).mockResolvedValue('2.11.4')
  vi.mocked(qbt.getCategories).mockResolvedValue([
    { name: 'TV Shows', savePath: '/data/tv' },
    { name: 'Movies', savePath: '/data/movies' },
    { name: 'Anime', savePath: '' },
  ])
  vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 2 })
  vi.mocked(tmdb.checkTmdb).mockResolvedValue()
  vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
    tmdb: { configured: true, source: 'saved' },
    qbittorrent: { configured: true, source: 'env' },
    downloads: null,
  })
  vi.mocked(serverSettings.saveDownloadDefaults).mockResolvedValue({
    tmdb: { configured: true, source: 'saved' },
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
    expect(await within(connection('qBittorrent')).findByText('Connected · qBittorrent v5.3.0 · API 2.11.4')).toBeInTheDocument()
    expect(await within(connection('Prowlarr')).findByText('Connected · 2 indexers · v1.24.3')).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByText('Connected')).toBeInTheDocument()
  })

  it('explains failures and checks again on Test', async () => {
    vi.mocked(prowlarr.getProwlarrStatus).mockRejectedValue(new prowlarr.ProwlarrSetupError(502, 'unauthorized'))
    vi.mocked(tmdb.checkTmdb).mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderScreen()
    expect(await within(connection('Prowlarr')).findByText('Not set up, or the API key was rejected')).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByText('The API key is missing or invalid')).toBeInTheDocument()

    vi.mocked(prowlarr.getProwlarrStatus).mockResolvedValue({ version: '1.24.3', indexers: 1 })
    await userEvent.click(within(connection('Prowlarr')).getByRole('button', { name: 'Test' }))
    expect(await within(connection('Prowlarr')).findByText('Connected · 1 indexer · v1.24.3')).toBeInTheDocument()
  })

  it('changes the TMDB key and checks the connection again', async () => {
    vi.mocked(tmdb.checkTmdb).mockRejectedValue(new tmdb.TmdbKeyError(401))
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    renderScreen()
    expect(await within(connection('TMDB')).findByText('The API key is missing or invalid')).toBeInTheDocument()

    vi.mocked(tmdb.checkTmdb).mockResolvedValue()
    await userEvent.click(within(connection('TMDB')).getByRole('button', { name: 'Change TMDB key' }))
    const sheet = screen.getByRole('dialog', { name: 'TMDB key' })
    await userEvent.type(within(sheet).getByLabelText('API key or read access token'), 'abc123')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(serverSettings.saveTmdbKey).toHaveBeenCalledWith('abc123')
    expect(await screen.findByText('TMDB key saved')).toBeInTheDocument()
    expect(await within(connection('TMDB')).findByText('Connected')).toBeInTheDocument()
  })

  it('shows the app version', () => {
    renderScreen()
    const row = screen.getByText('Version').closest('li')!
    expect(row).toHaveTextContent(__APP_VERSION__)
  })

  it('confirms clearing the cache', async () => {
    vi.mocked(matches.clearGuesses).mockResolvedValue({})
    renderScreen()
    await userEvent.click(screen.getByRole('button', { name: /Clear cache/ }))
    expect(await screen.findByText('Cache cleared')).toBeInTheDocument()
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
    expect(getSettings()).toMatchObject({ movieCategory: 'Anime', startPaused: true, sequential: false })
    expect(screen.getByText(/the same on every device/)).toBeInTheDocument()
  })

  it("shows the download defaults the server keeps, set on another device", async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({
      tmdb: { configured: true, source: 'saved' },
      qbittorrent: { configured: true, source: 'env' },
      downloads: { tvCategory: 'Anime', sequential: true },
    })
    renderScreen()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Sequential download' })).toBeChecked())
    expect(screen.getByRole('combobox', { name: 'Series category' })).toHaveDisplayValue('Anime')
    expect(screen.getByRole('switch', { name: 'Start paused' })).not.toBeChecked()
  })

  it('chooses the TMDB language', async () => {
    renderScreen()
    const group = screen.getByRole('radiogroup', { name: 'Titles and descriptions' })
    expect(within(group).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: 'Русский' }))
    expect(getSettings().tmdbLanguage).toBe('ru-RU')
  })


  it('explains how to add the app to the Dock in Safari on a Mac', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    )
    renderScreen()
    await userEvent.click(screen.getByRole('button', { name: /Install app/ }))
    expect(screen.getByRole('dialog', { name: 'Add to Dock' })).toHaveTextContent('Choose “Add to Dock”')
  })

  it('links to Ideas, a bug report with the version filled in, and the source code, each in a new tab', () => {
    renderScreen()
    const about = screen.getByRole('region', { name: 'About' })
    const links: [RegExp, string][] = [
      [/Suggest an idea/, IDEAS_URL],
      [/Report a bug/, BUG_REPORT_URL],
      [/Kinoseed on GitHub/, REPO_URL],
    ]
    for (const [name, href] of links) {
      const link = within(about).getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
    }
    const bugReport = new URL(BUG_REPORT_URL)
    expect(bugReport.pathname).toBe('/MrShakhov/kinoseed/issues/new')
    expect(bugReport.searchParams.get('template')).toBe('bug_report.yml')
    expect(bugReport.searchParams.get('version')).toBe(__APP_VERSION__)
  })

  it("credits TMDB with its logo and the notice its terms ask for, in TMDB's English in any language", async () => {
    await i18n.changeLanguage('ru')
    renderScreen()
    const about = screen.getByRole('region', { name: 'О приложении' })
    expect(within(about).getByRole('img', { name: 'TMDB' })).toBeInTheDocument()
    expect(about).toHaveTextContent('Данные о фильмах и сериалах и постеры берутся из TMDB.')
    expect(
      within(about).getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.'),
    ).toHaveAttribute('lang', 'en')
  })

  it('has no install row where the app can\'t be installed', () => {
    renderScreen()
    expect(screen.queryByRole('button', { name: /Install app/ })).not.toBeInTheDocument()
  })
})
