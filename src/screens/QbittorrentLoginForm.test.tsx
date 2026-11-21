import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import { SettingsError } from '../api/settings'
import { saying } from '../test/render'
import { QbittorrentLoginForm } from './QbittorrentLoginForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  findAddresses: vi.fn(),
}))

const findAddresses = vi.mocked(serverSettings.findAddresses)

// What the form does is tested through the connect screen, which also has Retry and Change;
// here only what differs where it stands alone, as in Settings' sheet.
describe('QbittorrentLoginForm', () => {
  it('says who didn’t answer without Retry when it has none to offer', async () => {
    render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))} onEnvAddress={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('qBittorrent address'), 'http://qbt.test')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const banner = await screen.findByRole('alert', { name: saying(/Kinopeer/) })
    expect(banner).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('is busy only while the server checks, sends nothing more meanwhile, and takes the last error back as it tries again', async () => {
    const banned = saying('Too many failed attempts. qBittorrent has blocked this address for a while.')
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new SettingsError(403, 'banned'))
      .mockReturnValueOnce(new Promise<void>(() => {}))
    render(<QbittorrentLoginForm className="key-form" onSubmit={onSubmit} onEnvAddress={vi.fn()} />)
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect).not.toHaveAttribute('aria-busy')
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(connect)
    expect(await screen.findByRole('alert', { name: banned })).toBeInTheDocument()
    expect(connect).not.toHaveAttribute('aria-busy')

    await userEvent.click(connect)
    expect(connect).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert', { name: banned })).not.toBeInTheDocument()
    // Enter again while it's checked: a wrong password would count twice toward qBittorrent's ban.
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  describe('Find (#511)', () => {
    it('fills the address with one Find found, which takes back the error and the hint on it', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new SettingsError(502, 'unreachable', 'refused', { container: { hostAddress: 'http://host.docker.internal:8080' } }))
      findAddresses.mockResolvedValue(['http://qbittorrent:8080'])
      render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={onSubmit} onEnvAddress={vi.fn()} />)
      const address = screen.getByLabelText('qBittorrent address')
      await userEvent.type(address, 'http://localhost:8080')
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      await vi.waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(screen.getByRole('button', { name: 'Use this address' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
      await userEvent.click(await screen.findByRole('button', { name: 'http://qbittorrent:8080' }))
      expect(address).toHaveValue('http://qbittorrent:8080')
      expect(address).not.toHaveAttribute('aria-invalid')
      expect(screen.queryByRole('button', { name: 'Use this address' })).not.toBeInTheDocument()
    })

    it('says the server’s refusals of Find as for a connect', async () => {
      const onEnvAddress = vi.fn()
      findAddresses.mockRejectedValueOnce(new SettingsError(409, 'auth-off')).mockRejectedValueOnce(new SettingsError(409, 'env-address'))
      render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={vi.fn()} onEnvAddress={onEnvAddress} />)
      const find = screen.getByRole('button', { name: 'Find qBittorrent' })
      await userEvent.click(find)
      expect(await screen.findByRole('alert', { name: saying('Kinopeer’s own login is off, so qBittorrent’s address can only be set on the server: QBITTORRENT_URL.') })).toBeInTheDocument()
      expect(onEnvAddress).not.toHaveBeenCalled()
      await userEvent.click(find)
      await vi.waitFor(() => expect(onEnvAddress).toHaveBeenCalledTimes(1))
    })

    it('isn’t offered where the form doesn’t ask for the address', () => {
      render(<QbittorrentLoginForm className="key-form" onSubmit={vi.fn()} onEnvAddress={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Find qBittorrent' })).not.toBeInTheDocument()
    })
  })
})
