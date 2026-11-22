import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UnsupportedQbittorrent } from './UnsupportedQbittorrent'

describe('UnsupportedQbittorrent', () => {
  it('names the version, the oldest one Kinopeer works with and what to do', async () => {
    const onRetry = vi.fn()
    render(<UnsupportedQbittorrent version="4.5.5" onRetry={onRetry} />)

    expect(screen.getByRole('heading', { name: 'qBittorrent 4.5.5 is too old' })).toBeInTheDocument()
    expect(
      screen.getByText('Kinopeer works with qBittorrent 4.6.0 or later. Update qBittorrent, then try again.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('names 5.2.0 as the oldest in the WebUI build', () => {
    vi.stubGlobal('__WEBUI__', true)
    render(<UnsupportedQbittorrent version="5.1.4" onRetry={() => {}} />)
    expect(screen.getByText('Kinopeer works with qBittorrent 5.2.0 or later. Update qBittorrent, then try again.')).toBeInTheDocument()
  })
})
