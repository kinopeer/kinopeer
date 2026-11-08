import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { ToastProvider } from '../components/Toast'
import { useSpeedLimits } from './useSpeedLimits'
import { saying } from '../test/render'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  setSpeedLimits: vi.fn(),
}))

const setSpeedLimits = vi.mocked(api.setSpeedLimits)

const ANDOR = torrent('andor', { name: 'Andor.S02.1080p' })
const ALIEN = torrent('alien', { name: 'Alien.Romulus.2024.1080p' })

function Harness({ torrents, refresh }: { torrents: Record<string, Torrent>; refresh: () => void }) {
  const limits = useSpeedLimits({ torrents, offline: false, refresh, titleOf: (item) => `Title of ${item.name}` })
  return (
    <section aria-label="Screen">
      {Object.keys(torrents).map((hash) => (
        <button key={hash} type="button" onClick={() => limits.open(hash)}>
          Open {hash}
        </button>
      ))}
      {limits.element}
    </section>
  )
}

function renderLimits(torrents: Record<string, Torrent> = { andor: ANDOR, alien: ALIEN }) {
  const refresh = vi.fn()
  const view = render(<Harness torrents={torrents} refresh={refresh} />, { wrapper: ToastProvider })
  const open = async (hash = 'andor') => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${hash}` }))
    return screen.getByRole('dialog', { name: 'Speed limits' })
  }
  const save = async (sheet: HTMLElement, download: string) => {
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Download limit, MB/s' }), download)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
  }
  // Escape, which jsdom doesn't turn into the dialog's cancel event.
  const dismiss = (sheet: HTMLElement) => fireEvent(sheet, new Event('cancel', { cancelable: true }))
  const rerender = (next: Record<string, Torrent>) => view.rerender(<Harness torrents={next} refresh={refresh} />)
  return { refresh, open, save, dismiss, rerender }
}

/** A save that settles when the test says so. */
function pendingSave() {
  const settle = { saved: () => {}, refused: () => {} }
  setSpeedLimits.mockReturnValueOnce(
    new Promise<void>((resolve, reject) => {
      settle.saved = resolve
      settle.refused = () => reject(new Error('500'))
    }),
  )
  return settle
}

const FAILED_CLOSED = 'Couldn’t save the speed limits of Title of Andor.S02.1080p, or saved only some. Open them again to check.'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useSpeedLimits', () => {
  it('opens for a torrent with its title, saves the limits for it, closes and asks qBittorrent again', async () => {
    setSpeedLimits.mockResolvedValue()
    const { open, save, refresh } = renderLimits()
    const sheet = await open()
    expect(within(sheet).getByText('Title of Andor.S02.1080p')).toBeInTheDocument()
    await save(sheet, '2')
    expect(setSpeedLimits).toHaveBeenCalledWith(['andor'], { download: 2_000_000, upload: undefined })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps the sheet open with the failure and asks qBittorrent again, since one of the two may have gone through', async () => {
    setSpeedLimits.mockRejectedValue(new Error('500'))
    const { open, save, refresh } = renderLimits()
    const sheet = await open()
    await save(sheet, '2')
    expect(await within(sheet).findByRole('alert', { name: saying(/Couldn’t save the limits, or saved only some/) })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sends the limits once, however often the form is submitted while they’re being saved', async () => {
    pendingSave()
    const { open } = renderLimits()
    const sheet = await open()
    const field = within(sheet).getByRole('textbox', { name: 'Download limit, MB/s' })
    fireEvent.change(field, { target: { value: '3' } })
    // Submitted on the form itself, as Enter in a field would, past the disabled Save button.
    const form = field.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    // A second request could land after the first and leave qBittorrent with either.
    expect(setSpeedLimits).toHaveBeenCalledTimes(1)
  })

  it('says in a toast when a save fails after its sheet was closed', async () => {
    const settle = pendingSave()
    const { open, save, dismiss, refresh } = renderLimits()
    const sheet = await open()
    await save(sheet, '2')
    dismiss(sheet)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    settle.refused()
    expect(await screen.findByRole('status')).toHaveTextContent(FAILED_CLOSED)
    expect(refresh).toHaveBeenCalled()
  })

  it('says in a toast when a save fails after its torrent went away', async () => {
    const settle = pendingSave()
    const { open, save, rerender } = renderLimits()
    await save(await open(), '2')
    rerender({ alien: ALIEN })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    settle.refused()
    expect(await screen.findByRole('status')).toHaveTextContent(FAILED_CLOSED)
  })

  it('shows a save from a closed sheet in the one opened again for the same torrent, and closes that once saved', async () => {
    const settle = pendingSave()
    const { open, save, dismiss } = renderLimits()
    const first = await open()
    await save(first, '2')
    dismiss(first)
    const again = await open()
    // Still being saved, so it can't be sent a second time.
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    settle.saved()
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says in the sheet opened again for the same torrent that the save from the closed one failed', async () => {
    const settle = pendingSave()
    const { open, save, dismiss } = renderLimits()
    const first = await open()
    await save(first, '2')
    dismiss(first)
    const again = await open()
    settle.refused()
    expect(await within(again).findByRole('alert', { name: saying(/Couldn’t save the limits, or saved only some/) })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a sheet opened for another torrent since when a save from a closed sheet comes back', async () => {
    const settle = pendingSave()
    const { open, save, dismiss, refresh } = renderLimits()
    const andor = await open('andor')
    await save(andor, '2')
    dismiss(andor)
    const alien = await open('alien')
    expect(within(alien).getByText('Title of Alien.Romulus.2024.1080p')).toBeInTheDocument()
    expect(within(alien).getByRole('button', { name: 'Save' })).toBeEnabled()
    settle.saved()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Speed limits' })).toBe(alien)
    expect(within(alien).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('says in a toast, not in a sheet opened for another torrent since, that a save from a closed sheet failed', async () => {
    const settle = pendingSave()
    const { open, save, dismiss } = renderLimits()
    const andor = await open('andor')
    await save(andor, '2')
    dismiss(andor)
    const alien = await open('alien')
    settle.refused()
    expect(await screen.findByRole('status')).toHaveTextContent(FAILED_CLOSED)
    expect(within(alien).queryByText(/Couldn’t save the limits/)).not.toBeInTheDocument()
  })

  it('keeps a torrent’s save busy when another torrent’s earlier save settles', async () => {
    const andorSave = pendingSave()
    pendingSave()
    const { open, save, dismiss, refresh } = renderLimits()
    const andor = await open('andor')
    await save(andor, '2')
    dismiss(andor)
    const alien = await open('alien')
    await save(alien, '3')
    andorSave.saved()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    // A second tap would send alien's limits again.
    expect(within(alien).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends again the limits a failed save sent, though they were put back, since qBittorrent may have taken them', async () => {
    // The download limit went from 1 to 2 MB/s and the upload one from none to 3; one request failed.
    setSpeedLimits.mockRejectedValueOnce(new Error('upload')).mockResolvedValueOnce()
    const { open } = renderLimits({ andor: { ...ANDOR, dl_limit: 1_000_000 } })
    const sheet = await open()
    const download = within(sheet).getByRole('textbox', { name: 'Download limit, MB/s' })
    const upload = within(sheet).getByRole('textbox', { name: 'Upload limit, MB/s' })
    await userEvent.clear(download)
    await userEvent.type(download, '2')
    await userEvent.type(upload, '3')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('alert', { name: saying(/Couldn’t save the limits/) })).toBeInTheDocument()

    await userEvent.clear(download)
    await userEvent.type(download, '1')
    await userEvent.clear(upload)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(setSpeedLimits).toHaveBeenLastCalledWith(['andor'], { download: 1_000_000, upload: 0 })
  })

  it('starts a sheet opened again mid-save from the limits being saved, so a retry after a failure sends those', async () => {
    const settle = pendingSave()
    const { open, dismiss } = renderLimits({ andor: { ...ANDOR, dl_limit: 1_000_000 }, alien: ALIEN })
    const first = await open()
    const field = within(first).getByRole('textbox', { name: 'Download limit, MB/s' })
    await userEvent.clear(field)
    await userEvent.type(field, '5')
    await userEvent.click(within(first).getByRole('button', { name: 'Save' }))
    dismiss(first)
    const again = await open()

    setSpeedLimits.mockResolvedValueOnce()
    settle.refused()
    expect(await within(again).findByRole('alert', { name: saying(/Couldn’t save the limits/) })).toBeInTheDocument()
    await userEvent.click(within(again).getByRole('button', { name: 'Save' }))
    // Not the 1 MB/s the torrent had when it was opened again, which would undo a part that went through.
    expect(setSpeedLimits).toHaveBeenLastCalledWith(['andor'], { download: 5_000_000, upload: undefined })
  })

  it('keeps a torrent’s save pending after another torrent’s save started, so it isn’t sent twice', async () => {
    const andorSave = pendingSave()
    pendingSave()
    const { open, save, dismiss } = renderLimits()
    const andor = await open('andor')
    await save(andor, '2')
    dismiss(andor)
    const alien = await open('alien')
    await save(alien, '3')
    dismiss(alien)
    const again = await open('andor')
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    andorSave.saved()
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('useSpeedLimits toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast its full time for each failure, though the title is the same as the last one’s', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { open, dismiss } = renderLimits()
    const failAfterClosing = async () => {
      const settle = pendingSave()
      const sheet = await open()
      await user.type(within(sheet).getByRole('textbox', { name: 'Download limit, MB/s' }), '2')
      await user.click(within(sheet).getByRole('button', { name: 'Save' }))
      dismiss(sheet)
      settle.refused()
      expect(await screen.findByRole('status')).toHaveTextContent(FAILED_CLOSED)
    }
    await failAfterClosing()
    act(() => vi.advanceTimersByTime(3000))
    await failAfterClosing()
    // 5 s after the first failure, 2 s after the second: the toast stays for the second's 4 s.
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('status')).toHaveTextContent(FAILED_CLOSED)
    act(() => vi.advanceTimersByTime(2500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
