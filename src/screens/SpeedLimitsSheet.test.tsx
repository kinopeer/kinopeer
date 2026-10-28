import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { SpeedLimitsSheet } from './SpeedLimitsSheet'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  setSpeedLimits: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('SpeedLimitsSheet', () => {
  function renderSheet(fields = {}, offline = false) {
    const handlers = { onClose: vi.fn(), onChanged: vi.fn() }
    renderWithRouter(<SpeedLimitsSheet torrent={torrent('h1', fields)} title="Inception" offline={offline} {...handlers} />)
    return handlers
  }

  it("can't save while qBittorrent is unreachable, but keeps what was typed", async () => {
    renderSheet({}, true)
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })

  it('saves a changed limit, then refreshes the list and closes', async () => {
    vi.mocked(api.setSpeedLimits).mockResolvedValue()
    const handlers = renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), '0,5')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(api.setSpeedLimits).toHaveBeenCalledWith(['h1'], { download: undefined, upload: 500_000 })
    expect(handlers.onChanged).toHaveBeenCalled()
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it('removes a limit when its field is cleared', async () => {
    vi.mocked(api.setSpeedLimits).mockResolvedValue()
    renderSheet({ dl_limit: 1_000_000, up_limit: 300_000 })
    await userEvent.clear(screen.getByRole('textbox', { name: 'Download limit, MB/s' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(api.setSpeedLimits).toHaveBeenCalledWith(['h1'], { download: 0, upload: undefined })
  })

  it('closes without saving when nothing changed', async () => {
    const handlers = renderSheet({ dl_limit: 4096 })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('0.004')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(api.setSpeedLimits).not.toHaveBeenCalled()
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it("doesn't save a value that isn't a number", async () => {
    renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), 'abc')
    expect(screen.getByText('Enter a number, e.g. 2.5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })

  it('keeps the sheet open with an error when qBittorrent refuses, and refreshes the list for a partial save', async () => {
    // The download limit may already be applied when the upload request fails.
    vi.mocked(api.setSpeedLimits).mockRejectedValue(new Error('down'))
    const handlers = renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(await screen.findByText(/Couldn't save the limits, or saved only some/)).toBeInTheDocument()
    expect(handlers.onChanged).toHaveBeenCalled()
    expect(handlers.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeEnabled()
  })
})
