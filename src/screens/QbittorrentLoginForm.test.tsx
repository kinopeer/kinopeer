import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
})
