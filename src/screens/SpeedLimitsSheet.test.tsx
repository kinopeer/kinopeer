import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { torrent } from '../test/fixtures'
import { renderWithRouter, saying } from '../test/render'
import { SpeedLimitsSheet, type SpeedLimitsChange, type SpeedLimitsSheetProps } from './SpeedLimitsSheet'

describe('SpeedLimitsSheet', () => {
  function renderSheet(fields = {}, props: Partial<SpeedLimitsSheetProps> = {}) {
    const handlers = { onClose: vi.fn(), onSave: vi.fn() }
    renderWithRouter(
      <SpeedLimitsSheet torrent={torrent('h1', fields)} title="Inception" offline={false} {...handlers} {...props} />,
    )
    return handlers
  }

  it("can't save while qBittorrent is unreachable, but keeps what was typed", async () => {
    renderSheet({}, { offline: true })
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends only the changed limit', async () => {
    const handlers = renderSheet()
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), '0,5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    const handlers = renderSheet({}, { pending: { download: 3_000_000 } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    // Neither a click nor Enter in a field sends them while a save is in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '{Enter}')
    expect(handlers.onSave).not.toHaveBeenCalled()
  })

  it('keeps the fields as they are while the limits are being saved, since what’s typed then would be lost', async () => {
    renderSheet({}, { pending: { download: 3_000_000 } })
    const field = screen.getByRole('textbox', { name: 'Download limit, MB/s' })
    await userEvent.type(field, '5')
    expect(field).toHaveValue('3')
    await userEvent.type(screen.getByRole('textbox', { name: 'Upload limit, MB/s' }), '5')
    expect(screen.getByRole('textbox', { name: 'Upload limit, MB/s' })).toHaveValue('')
  })

  it('sends again the limits a failed save sent, so one that did go through can be put back', async () => {
    // The download limit was 1 MB/s; a save sent 2 and 3 MB/s and failed, maybe after taking one.
    const handlers = renderSheet({ dl_limit: 1_000_000 }, { failure: { download: 2_000_000, upload: 3_000_000 } })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(handlers.onSave).toHaveBeenCalledWith({ download: 1_000_000, upload: 0 })
  })

  it('starts from the limits being saved when opened while a save is in flight, as the sheet that sent them did', () => {
    renderSheet({ dl_limit: 1_000_000, up_limit: 300_000 }, { pending: { download: 5_000_000, upload: 0 } })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('5')
    expect(screen.getByRole('textbox', { name: 'Upload limit, MB/s' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('removes a limit when its field is cleared', async () => {
    const handlers = renderSheet({ dl_limit: 1_000_000, up_limit: 300_000 })
    await userEvent.clear(screen.getByRole('textbox', { name: 'Download limit, MB/s' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(handlers.onSave).toHaveBeenCalledWith({ download: 0, upload: undefined })
  })

  it('closes without saving when nothing changed', async () => {
    const handlers = renderSheet({ dl_limit: 4096 })
    expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('0.004')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // An unchanged field is never sent, not even as is.
    expect(handlers.onClose).toHaveBeenCalled()
    expect(handlers.onSave).not.toHaveBeenCalled()
  })

  it("doesn't save a value that isn't a number", async () => {
    renderSheet()
    const upload = screen.getByRole('textbox', { name: 'Upload limit, MB/s' })
    await userEvent.type(upload, 'abc')
    expect(upload).toHaveAccessibleDescription('Enter a number from 0.001 to 2147, or leave it empty for no limit')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(download, '5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('says a failed save failed, and lets it be tried again', () => {
    renderSheet({}, { failure: { download: 2_000_000 } })
    expect(screen.getByRole('alert', { name: saying(/Couldn’t save the limits, or saved only some/) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  describe('Remove limits', () => {
    it.each([
      ['a download limit', { dl_limit: 2_000_000 }],
      ['an upload limit', { up_limit: 500_000 }],
    ])('is offered for a torrent with %s of its own, and sends both limits as none at once', async (_, fields) => {
      const handlers = renderSheet(fields)
      await userEvent.click(screen.getByRole('button', { name: 'Remove limits' }))
      expect(handlers.onSave).toHaveBeenCalledExactlyOnceWith({ download: 0, upload: 0 })
      expect(handlers.onClose).not.toHaveBeenCalled()
    })

    it.each([
      ['0', 0],
      ['-1', -1],
    ])('isn’t offered for a torrent with no limit of its own (%s), even with a limit typed', async (_, none) => {
      renderSheet({ dl_limit: none, up_limit: none })
      await userEvent.type(screen.getByRole('textbox', { name: 'Download limit, MB/s' }), '3')
      expect(screen.queryByRole('button', { name: 'Remove limits' })).not.toBeInTheDocument()
    })

    it('is off while qBittorrent is unreachable, as Save is', async () => {
      const handlers = renderSheet({ dl_limit: 2_000_000 }, { offline: true })
      expect(screen.getByRole('button', { name: 'Remove limits' })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Remove limits' }))
      expect(handlers.onSave).not.toHaveBeenCalled()
    })

    it('isn’t offered while a save is in flight, which shows busy on Save', () => {
      renderSheet({ dl_limit: 2_000_000 }, { pending: { download: 0, upload: 0 } })
      expect(screen.queryByRole('button', { name: 'Remove limits' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    })

    it('empties the fields as it sends, so they show what’s being saved', async () => {
      renderSheet({ dl_limit: 2_500_000, up_limit: 500_000 })
      await userEvent.click(screen.getByRole('button', { name: 'Remove limits' }))
      expect(screen.getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('')
      expect(screen.getByRole('textbox', { name: 'Upload limit, MB/s' })).toHaveValue('')
    })

    it('leaves Save sending no limits after a failed removal, not the old ones back', async () => {
      const onSave = vi.fn()
      // A screen whose every save fails, handing the sheet what it sent as the failure.
      function Failing() {
        const [failure, setFailure] = useState<SpeedLimitsChange>()
        const save = (limits: SpeedLimitsChange) => {
          onSave(limits)
          setFailure(limits)
        }
        return (
          <SpeedLimitsSheet torrent={torrent('h1', { dl_limit: 2_500_000 })} title="Inception" offline={false} failure={failure} onSave={save} onClose={vi.fn()} />
        )
      }
      renderWithRouter(<Failing />)
      await userEvent.click(screen.getByRole('button', { name: 'Remove limits' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenNthCalledWith(2, { download: 0, upload: 0 })
    })

    it('is offered again after a failed save, beside what the failure says', () => {
      renderSheet({ dl_limit: 2_000_000 }, { failure: { download: 0, upload: 0 } })
      expect(screen.getByRole('alert', { name: saying(/Couldn’t save the limits/) })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove limits' })).toBeEnabled()
    })
  })
})
