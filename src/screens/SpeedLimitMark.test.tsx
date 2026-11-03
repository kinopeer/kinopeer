import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpeedLimitMark } from './SpeedLimitMark'

describe('SpeedLimitMark', () => {
  it('is a gauge with an arrow for each direction with a limit, named by the limits', () => {
    render(<SpeedLimitMark torrent={{ dl_limit: 2_000_000, up_limit: 0 }} />)
    expect(screen.getByRole('img', { name: 'Speed limit: download up to 2.0\u00a0MB/s' })).toHaveTextContent(/^↓$/)
  })

  it('shows the upload limit alone, and both when both are set', () => {
    const { unmount } = render(<SpeedLimitMark torrent={{ dl_limit: -1, up_limit: 500_000 }} />)
    expect(screen.getByRole('img', { name: 'Speed limit: upload up to 500\u00a0KB/s' })).toHaveTextContent(/^↑$/)
    unmount()

    render(<SpeedLimitMark torrent={{ dl_limit: 2_000_000, up_limit: 500_000 }} />)
    expect(screen.getByRole('img', { name: 'Speed limits: download up to 2.0\u00a0MB/s, upload up to 500\u00a0KB/s' })).toHaveTextContent(
      /^↓↑$/,
    )
  })

  it('shows nothing for a torrent without limits of its own', () => {
    const { container } = render(<SpeedLimitMark torrent={{ dl_limit: 0, up_limit: -1 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
