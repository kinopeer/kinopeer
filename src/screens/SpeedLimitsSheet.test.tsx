import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import i18n from '../i18n'
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

  it('says under each field that an empty one means no limit', () => {
    renderSheet()
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveAccessibleDescription('Empty: no limit')
    expect(screen.getByRole('textbox', { name: 'Upload limit, MB/s' })).toHaveAccessibleDescription('Empty: no limit')
  })

  it("fills the fields with the interface language's decimal separator", async () => {
    await i18n.changeLanguage('ru')
    renderSheet({ dl_limit: 2_500_000 })
    expect(screen.getByRole('textbox', { name: 'Лимит загрузки, МБ/с' })).toHaveValue('2,5')
  })

  it("disables Save while the limits are being saved, so they aren't sent twice", async () => {
    vi.mocked(api.setSpeedLimits).mockReturnValue(new Promise(() => {}))
    renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    // One call: the click went through, and a second one couldn't follow while it's pending.
    expect(api.setSpeedLimits).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Save limits/ })).toBeDisabled()
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
    // onClose has run, so the save is over: an unchanged field is never sent, not even as is.
    expect(handlers.onClose).toHaveBeenCalled()
    expect(api.setSpeedLimits).not.toHaveBeenCalled()
  })

  it("doesn't save a value that isn't a number", async () => {
    renderSheet()
    const upload = screen.getByRole('textbox', { name: 'Upload limit, MB/s' })
    await userEvent.type(upload, 'abc')
    expect(upload).toHaveAccessibleDescription('Enter a number from 0.001 to 2147, e.g. 2.5')
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
