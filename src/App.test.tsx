import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api/qbittorrent'
import App from './App'

vi.mock('./api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getAppVersion: vi.fn(), getMainData: vi.fn(), login: vi.fn(), logout: vi.fn() }
})

const getAppVersion = vi.mocked(api.getAppVersion)
const getMainData = vi.mocked(api.getMainData)

beforeEach(() => {
  vi.resetAllMocks()
  getAppVersion.mockResolvedValue('v5.2.4')
  getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: {} })
})

afterEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('goes straight in when qBittorrent needs no login', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
    expect(screen.getByText('Connected · qBittorrent v5.2.4')).toBeInTheDocument()
  })

  it('returns to sign-in when the session expires while polling', async () => {
    getAppVersion.mockReset().mockResolvedValueOnce('v5.2.4').mockRejectedValue(new api.UnauthorizedError())
    getMainData.mockRejectedValue(new api.UnauthorizedError())
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Connect qBittorrent' })).toBeInTheDocument()
  })

  it('shows the sign-in form without a session', async () => {
    getAppVersion.mockRejectedValue(new api.UnauthorizedError())
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Connect qBittorrent' })).toBeInTheDocument()
  })

  it('switches the theme on the root element', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switches the language and remembers it', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Русский' }))
    expect(screen.getByRole('heading', { name: 'Загрузки' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Светлая' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(localStorage.getItem('kinoseed.lang')).toBe('ru')
  })
})
