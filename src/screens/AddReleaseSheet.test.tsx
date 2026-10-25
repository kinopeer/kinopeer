import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as adding from '../releases/addRelease'
import { parseRelease } from '../releases/parseRelease'
import { resetSettings, updateSettings } from '../settings/settings'
import * as torrentFile from '../torrents/torrentFile'
import { AddReleaseSheet } from './AddReleaseSheet'

vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  fetchRelease: vi.fn(),
}))
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getCategories: vi.fn(),
  getDefaultSavePath: vi.fn(),
  getMainData: vi.fn(),
}))
vi.mock('../releases/addRelease', () => ({ addRelease: vi.fn() }))
vi.mock('../torrents/torrentFile', async (importOriginal) => ({
  ...(await importOriginal<typeof torrentFile>()),
  readTorrentFile: vi.fn(),
}))

const fetchRelease = vi.mocked(prowlarr.fetchRelease)
const addRelease = vi.mocked(adding.addRelease)
const readTorrentFile = vi.mocked(torrentFile.readTorrentFile)

const RELEASE: Release = {
  id: 'bb',
  title: 'Breaking.Bad.S01-S02.1080p.BluRay.x264',
  indexer: 'Kinozal',
  size: 50e9,
  seeders: 486,
  categories: [5000],
  download: '1/download?link=bb',
}
const FILE = new File([new Uint8Array([1])], 'bb.torrent')
const META = {
  infoHash: 'abc123',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10e9 },
    { path: 'Season 2/e01.mkv', size: 20e9 },
    { path: 'Season 2/e02.mkv', size: 20e9 },
  ],
  totalSize: 50e9,
}

function renderSheet(release = RELEASE) {
  const onAdded = vi.fn()
  const onClose = vi.fn()
  render(
    <AddReleaseSheet
      release={release}
      info={parseRelease(release.title)}
      title={{ type: 'tv', id: 1396, name: 'Breaking Bad', posterPath: null }}
      onClose={onClose}
      onAdded={onAdded}
    />,
  )
  return { onAdded, onClose }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  fetchRelease.mockResolvedValue({ kind: 'torrent', file: FILE })
  readTorrentFile.mockResolvedValue(META)
  vi.mocked(qbt.getCategories).mockResolvedValue([
    { name: 'Movies', savePath: '/data/movies' },
    { name: 'TV', savePath: '/data/tv' },
  ])
  vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
  vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
  addRelease.mockResolvedValue()
})

describe('AddReleaseSheet', () => {
  it('picks files by season and adds the release to its category with the title tag', async () => {
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(sheet).not.toHaveClass('ks-sheet-lg')
    expect(within(sheet).getByText('Breaking Bad')).toBeInTheDocument()
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()

    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    // Full height on phones, the tall modal on desktop.
    expect(picker).toHaveClass('ks-sheet-lg')
    expect(within(picker).getByText('Not enough free space')).toBeInTheDocument()
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Season 1' }))
    await userEvent.click(within(picker).getByRole('button', { name: /Season 2/ }))
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'e02.mkv' }))
    expect(within(picker).getByRole('checkbox', { name: 'Season 2' })).toHaveAttribute('aria-checked', 'mixed')
    expect(within(picker).getByText('1 of 3 · 20.0 GB')).toBeInTheDocument()
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))

    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: 1 of 3/ })).toBeInTheDocument()
    await userEvent.click(within(back).getByRole('button', { name: /^Download · 20\.0\sGB$/ }))

    expect(addRelease).toHaveBeenCalledWith(
      { kind: 'torrent', file: FILE },
      { tags: ['tmdb:tv:1396'], category: 'TV', savePath: undefined, paused: false, sequential: false, topOfQueue: false },
      { meta: META, skip: [0, 2] },
    )
    expect(onAdded).toHaveBeenCalled()
  })

  it('applies the chosen options', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'No category' }))
    await userEvent.type(within(sheet).getByLabelText('Save path'), '/mnt/tv')
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Start paused' }))
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Add to top of queue' }))
    expect(within(sheet).getByText('/mnt/tv')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))

    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      { tags: ['tmdb:tv:1396'], category: undefined, savePath: '/mnt/tv', paused: true, sequential: false, topOfQueue: true },
      { meta: META, skip: [] },
    )
  })

  it('starts from the defaults in Settings', async () => {
    updateSettings({ tvCategory: 'Movies', startPaused: true, sequential: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('Movies → /data/movies')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: 'Movies', paused: true, sequential: true }),
      expect.anything(),
    )
  })

  it('follows defaults that arrive after it opened, until the user flips them', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    const paused = within(sheet).getByRole('switch', { name: 'Start paused' })
    const sequential = within(sheet).getByRole('switch', { name: 'Sequential download' })
    expect(paused).not.toBeChecked()

    // The server's defaults load while the sheet is open.
    act(() => updateSettings({ startPaused: true }))
    expect(paused).toBeChecked()

    await userEvent.click(sequential)
    act(() => updateSettings({ sequential: false, startPaused: false }))
    expect(sequential).toBeChecked()
    expect(paused).not.toBeChecked()
  })

  it('retries getting the torrent and adds a magnet link without file selection', async () => {
    fetchRelease.mockRejectedValueOnce(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    fetchRelease.mockResolvedValueOnce({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Try again' }))

    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Files:/ })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ }))
    expect(addRelease).toHaveBeenCalledWith({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' }, expect.anything(), undefined)
  })

  it('says when qBittorrent refuses the torrent', async () => {
    addRelease.mockRejectedValue(new qbt.QbittorrentError('Fails.', 200))
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('may already be in your downloads')
    expect(onAdded).not.toHaveBeenCalled()
  })
})
