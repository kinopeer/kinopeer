import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { MoveTorrentSheet } from './MoveTorrentSheet'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getSaveLocations: vi.fn(),
  setTorrentLocation: vi.fn(),
}))

const getSaveLocations = vi.mocked(api.getSaveLocations)
const setTorrentLocation = vi.mocked(api.setTorrentLocation)

const DUNE = { hash: 'dune', name: 'Dune.Part.Two.2024.2160p', save_path: '/downloads/' } as Torrent

function renderSheet() {
  const onClose = vi.fn()
  const onMoved = vi.fn()
  render(<MoveTorrentSheet torrent={DUNE} onClose={onClose} onMoved={onMoved} />)
  const field = screen.getByRole('textbox', { name: 'Folder' })
  const submit = screen.getByRole('button', { name: 'Move' })
  const moveTo = async (folder: string) => {
    await userEvent.clear(field)
    await userEvent.type(field, folder)
    await userEvent.click(submit)
  }
  return { onClose, onMoved, field, submit, moveTo }
}

beforeEach(() => {
  vi.resetAllMocks()
  getSaveLocations.mockResolvedValue({
    defaultPath: '/downloads/',
    categories: [
      { name: 'Movies', savePath: '/media/movies' },
      { name: 'TV', savePath: 'shows' },
      { name: 'Other', savePath: '' },
    ],
  })
  setTorrentLocation.mockResolvedValue()
})

describe('MoveTorrentSheet', () => {
  it('starts at the current folder and offers the folders qBittorrent knows', async () => {
    const { field, submit } = renderSheet()
    expect(field).toHaveValue('/downloads/')
    expect(submit).toBeDisabled()
    const folders = await screen.findByRole('group', { name: 'qBittorrent folders' })
    expect(folders).toHaveTextContent('/downloads/' + '/media/movies' + '/downloads/shows' + '/downloads/Other')
    await userEvent.click(screen.getByRole('button', { name: '/downloads/shows' }))
    expect(field).toHaveValue('/downloads/shows')
    expect(submit).toBeEnabled()
  })

  it('takes a typed folder when qBittorrent knows none', async () => {
    getSaveLocations.mockResolvedValue({ defaultPath: '', categories: [] })
    const { moveTo, onMoved } = renderSheet()
    await moveTo('/media/new')
    expect(screen.queryByRole('group', { name: 'qBittorrent folders' })).not.toBeInTheDocument()
    expect(onMoved).toHaveBeenCalledWith('/media/new')
  })

  it('moves to the folder typed, trimmed, and reports it', async () => {
    const { moveTo, onMoved } = renderSheet()
    await moveTo(' /media/new ')
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
    expect(onMoved).toHaveBeenCalledWith('/media/new')
  })

  it('says why qBittorrent refused, and stays open', async () => {
    const { moveTo, onMoved, submit } = renderSheet()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('no access', 403))
    await moveTo('/root')
    expect(await screen.findByText('qBittorrent has no access to that folder.')).toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new api.QbittorrentError('conflict', 409))
    await moveTo('/media/nope')
    expect(await screen.findByText('qBittorrent couldn’t create that folder.')).toBeInTheDocument()
    expect(screen.queryByText('qBittorrent has no access to that folder.')).not.toBeInTheDocument()
    setTorrentLocation.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await moveTo('/media/later')
    expect(await screen.findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
    expect(onMoved).not.toHaveBeenCalled()
    expect(submit).toBeEnabled()
  })

  it('can’t be closed while the move is being sent', async () => {
    let finish = () => {}
    setTorrentLocation.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const { moveTo, onClose, onMoved } = renderSheet()
    await moveTo('/media/new')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // A click on the dialog itself is a click on the backdrop.
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(onMoved).toHaveBeenCalledWith('/media/new'))
  })
})
