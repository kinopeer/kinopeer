import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as webui from '../api/qbittorrent/webui'
import { ToastProvider } from '../components/Toast'
import { namesTheFailedLink } from '../test/failedLinks'
import { QbittorrentInterfaceDialog } from './QbittorrentInterfaceDialog'

vi.mock('../api/qbittorrent/webui', () => ({ turnOffAlternativeWebui: vi.fn() }))

const turnOff = vi.mocked(webui.turnOffAlternativeWebui)

beforeEach(() => {
  // Its texts are the WebUI build's.
  vi.stubGlobal('__WEBUI__', true)
  turnOff.mockResolvedValue()
})

function renderDialog() {
  const location = { replace: vi.fn<(url: string) => void>() }
  const onClose = vi.fn()
  render(<QbittorrentInterfaceDialog onClose={onClose} location={location} />, { wrapper: ToastProvider })
  return { dialog: screen.getByRole('alertdialog', { name: 'Switch to qBittorrent’s interface?' }), location, onClose }
}

describe('QbittorrentInterfaceDialog', () => {
  it('says what switching changes and how to come back, and changes nothing until confirmed', async () => {
    const { dialog, location, onClose } = renderDialog()
    expect(within(dialog).getByText(/on every device and in every browser/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Tools → Options… → WebUI, turn on Use alternative WebUI and save/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(turnOff).not.toHaveBeenCalled()
    expect(location.replace).not.toHaveBeenCalled()
  })

  it("turns Kinopeer off in qBittorrent, then replaces the page with qBittorrent's root", async () => {
    let answer = () => {}
    turnOff.mockReturnValue(new Promise<void>((resolve) => (answer = resolve)))
    const { dialog, location } = renderDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch' }))
    // Not before qBittorrent took it: the page would still be Kinopeer's.
    expect(location.replace).not.toHaveBeenCalled()
    // Busy while it's on its way, so a second tap sends nothing.
    expect(within(dialog).getByRole('button', { name: 'Switch' })).toBeDisabled()

    answer()
    await vi.waitFor(() => expect(location.replace).toHaveBeenCalledExactlyOnceWith('/'))
    expect(turnOff).toHaveBeenCalledOnce()
    // Still busy while the page leaves.
    expect(within(dialog).getByRole('button', { name: 'Switch' })).toBeDisabled()
  })

  it('stays when qBittorrent refuses, says so, and tries again', async () => {
    turnOff.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { dialog, location } = renderDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t reach qBittorrent. Try again.')
    expect(location.replace).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch' }))
    await vi.waitFor(() => expect(location.replace).toHaveBeenCalledExactlyOnceWith('/'))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })
})

namesTheFailedLink('The switch to qBittorrent’s interface, when qBittorrent doesn’t take it', {
  service: 'qbittorrent',
  // Only the WebUI build has it.
  builds: ['webui'],
  show: async (error) => {
    turnOff.mockRejectedValue(error)
    const { dialog } = renderDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch' }))
    return within(dialog).findByRole('alert')
  },
  says: { service: 'Couldn’t reach qBittorrent' },
})
