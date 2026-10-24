import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api/qbittorrent'
import * as serverSettings from './api/settings'
import * as tmdb from './api/tmdb'
import App from './App'

vi.mock('./api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getAppVersion: vi.fn(), getApiVersion: vi.fn(), getCategories: vi.fn(), getMainData: vi.fn() }
})

vi.mock('./api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof serverSettings>()
  return { ...actual, getServerSettings: vi.fn(), saveTmdbKey: vi.fn() }
})

vi.mock('./api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getTrending: vi.fn(), getPopular: vi.fn() }
})

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
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
  vi.mocked(tmdb.getTrending).mockResolvedValue(empty)
  vi.mocked(tmdb.getPopular).mockResolvedValue(empty)
  vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
})

afterEach(() => {
  localStorage.clear()
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

  it('asks for the TMDB key when the server has none, then goes in', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockResolvedValue({ tmdb: { configured: true, source: 'saved' }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
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
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
    vi.mocked(serverSettings.saveTmdbKey).mockRejectedValue(new serverSettings.SettingsError(422, 'invalid-key'))
    renderApp()

    await userEvent.type(await screen.findByLabelText('API key or read access token'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('TMDB didn’t accept this key')).toBeInTheDocument()
    expect(screen.getByLabelText('API key or read access token')).toHaveAttribute('aria-invalid', 'true')
  })

  it('lets the TMDB key wait', async () => {
    vi.mocked(serverSettings.getServerSettings).mockResolvedValue({ tmdb: { configured: false, source: null }, qbittorrent: { configured: true, source: 'env' }, downloads: null })
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
    expect(localStorage.getItem('kinoseed.lang')).toBe('ru')
  })
})
