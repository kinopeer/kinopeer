import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsError } from '../api/settings'
import { saying } from '../test/render'
import { QbittorrentLoginForm } from './QbittorrentLoginForm'

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
})
