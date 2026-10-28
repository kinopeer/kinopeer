import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { RecheckDialog } from './RecheckDialog'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  recheckTorrents: vi.fn(),
}))

function renderDialog() {
  const handlers = { onClose: vi.fn(), onRechecked: vi.fn() }
  render(<RecheckDialog hash="dune" title="Dune: Part Two" {...handlers} />)
  return handlers
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('RecheckDialog', () => {
  it('says what a recheck does and starts it on confirm', async () => {
    vi.mocked(api.recheckTorrents).mockResolvedValue()
    const handlers = renderDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Recheck the files?' })
    expect(dialog).toHaveTextContent('qBittorrent will read the downloaded data of “Dune: Part Two” again.')
    await userEvent.click(screen.getByRole('button', { name: 'Force recheck' }))
    expect(api.recheckTorrents).toHaveBeenCalledWith(['dune'])
    expect(handlers.onRechecked).toHaveBeenCalled()
  })

  it('stays open with an error when qBittorrent doesn’t answer', async () => {
    vi.mocked(api.recheckTorrents).mockRejectedValue(new Error('500'))
    const handlers = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Force recheck' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach qBittorrent. Try again.')
    expect(handlers.onRechecked).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Force recheck' })).toBeEnabled()
  })

  it('cancels without a request', async () => {
    const handlers = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handlers.onClose).toHaveBeenCalled()
    expect(api.recheckTorrents).not.toHaveBeenCalled()
  })
})
