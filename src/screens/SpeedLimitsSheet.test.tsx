import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { torrent } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { SpeedLimitsSheet, type SpeedLimitsSheetProps } from './SpeedLimitsSheet'

describe('SpeedLimitsSheet', () => {
  function renderSheet(fields = {}, props: Partial<SpeedLimitsSheetProps> = {}) {
    const handlers = { onClose: vi.fn(), onSave: vi.fn() }
    renderWithRouter(
      <SpeedLimitsSheet torrent={torrent('h1', fields)} title="Inception" offline={false} saving={false} {...handlers} {...props} />,
    )
    return handlers
  }

  it("can't save while qBittorrent is unreachable, but keeps what was typed", async () => {
    renderSheet({}, { offline: true })
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })

  it('sends only the changed limit', async () => {
    const handlers = renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), '0,5')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(handlers.onSave).toHaveBeenCalledWith({ download: undefined, upload: 500_000 })
    expect(handlers.onClose).not.toHaveBeenCalled()
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
    const handlers = renderSheet({}, { saving: true })
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    expect(screen.getByRole('button', { name: /Save limits/ })).toBeDisabled()
    // Neither a click nor Enter in a field sends them while a save is in flight.
    await userEvent.click(screen.getByRole('button', { name: /Save limits/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '{Enter}')
    expect(handlers.onSave).not.toHaveBeenCalled()
  })

  it('sends again the limits a failed save sent, so one that did go through can be put back', async () => {
    // The download limit was 1 MB/s; a save sent both fields and failed, maybe after taking one.
    const handlers = renderSheet({ dl_limit: 1_000_000 }, { failure: { download: true, upload: true } })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('1')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(handlers.onSave).toHaveBeenCalledWith({ download: 1_000_000, upload: 0 })
  })

  it('removes a limit when its field is cleared', async () => {
    const handlers = renderSheet({ dl_limit: 1_000_000, up_limit: 300_000 })
    await userEvent.clear(screen.getByRole('textbox', { name: 'Download limit, MB/s' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(handlers.onSave).toHaveBeenCalledWith({ download: 0, upload: undefined })
  })

  it('closes without saving when nothing changed', async () => {
    const handlers = renderSheet({ dl_limit: 4096 })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('0.004')
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    // An unchanged field is never sent, not even as is.
    expect(handlers.onClose).toHaveBeenCalled()
    expect(handlers.onSave).not.toHaveBeenCalled()
  })

  it("doesn't save a value that isn't a number", async () => {
    renderSheet()
    const upload = screen.getByRole('textbox', { name: 'Upload limit, MB/s' })
    await userEvent.type(upload, 'abc')
    expect(upload).toHaveAccessibleDescription('Enter a number from 0.001 to 2147, or leave it empty for no limit')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })

  it("writes the bounds in that message with the interface language's decimal separator", async () => {
    await i18n.changeLanguage('ru')
    renderSheet()
    const upload = screen.getByRole('textbox', { name: 'Лимит отдачи, МБ/с' })
    await userEvent.type(upload, 'abc')
    expect(upload).toHaveAccessibleDescription(
      'Введите число от 0,001 до 2147 или оставьте поле пустым, чтобы снять лимит',
    )
  })

  it('shows no error for a lone separator, the start of a decimal like ,5, but saves only once it is one', async () => {
    renderSheet()
    const download = screen.getByRole('textbox', { name: 'Download limit, MB/s' })
    await userEvent.type(download, ',')
    expect(download).toHaveAccessibleDescription('Empty: no limit')
    expect(download).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
    await userEvent.type(download, '5')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeEnabled()
  })

  it('says a failed save failed, and lets it be tried again', () => {
    renderSheet({}, { failure: { download: true, upload: false } })
    expect(screen.getByText(/Couldn’t save the limits, or saved only some/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeEnabled()
  })
})
