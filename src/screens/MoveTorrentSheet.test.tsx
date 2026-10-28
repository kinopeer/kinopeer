import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { MoveTorrentSheet } from './MoveTorrentSheet'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getCategories: vi.fn(),
  getDefaultSavePath: vi.fn(),
  setTorrentLocation: vi.fn(),
}))

const setTorrentLocation = vi.mocked(api.setTorrentLocation)

const DUNE = { hash: 'dune', name: 'Dune.Part.Two.2024.2160p', save_path: '/downloads/' } as Torrent

function renderSheet() {
  const onMoved = vi.fn()
  render(<MoveTorrentSheet torrent={DUNE} onClose={vi.fn()} onMoved={onMoved} />)
  return { onMoved, field: screen.getByRole('textbox', { name: 'Folder' }), submit: screen.getByRole('button', { name: 'Move' }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getDefaultSavePath).mockResolvedValue('/downloads/')
  vi.mocked(api.getCategories).mockResolvedValue([
    { name: 'Movies', savePath: '/media/movies' },
    { name: 'Other', savePath: '' },
  ])
  setTorrentLocation.mockResolvedValue()
})

describe('MoveTorrentSheet', () => {
  it('starts at the current folder and offers the folders qBittorrent knows', async () => {
    const { field, submit } = renderSheet()
    expect(field).toHaveValue('/downloads/')
    expect(submit).toBeDisabled()
    await userEvent.click(await screen.findByRole('button', { name: '/media/movies' }))
    expect(field).toHaveValue('/media/movies')
    expect(screen.getAllByRole('button', { name: /^\// })).toHaveLength(2)
  })

  it('moves to the folder typed and reports it', async () => {
    const { field, submit, onMoved } = renderSheet()
    await userEvent.clear(field)
    await userEvent.type(field, ' /media/new ')
    await userEvent.click(submit)
    expect(setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/new')
    expect(onMoved).toHaveBeenCalledWith('/media/new')
  })

  it('stays open with an error when qBittorrent refuses', async () => {
    setTorrentLocation.mockRejectedValue(new api.QbittorrentError('no access', 403))
    const { field, submit, onMoved } = renderSheet()
    await userEvent.clear(field)
    await userEvent.type(field, '/root')
    await userEvent.click(submit)
    expect(await screen.findByText(/Couldn’t move the files/)).toBeInTheDocument()
    expect(onMoved).not.toHaveBeenCalled()
    expect(submit).toBeEnabled()
  })
})
