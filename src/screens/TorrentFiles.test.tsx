import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { DUNE_TORRENT } from '../test/fixtures'
import { TorrentFiles } from './TorrentFiles'
import { saying } from '../test/render'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTorrentFiles: vi.fn(),
  setFilePriority: vi.fn(),
}))

const getTorrentFiles = vi.mocked(api.getTorrentFiles)
const setFilePriority = vi.mocked(api.setFilePriority)

function renderFiles(disabled = false) {
  render(<TorrentFiles torrent={DUNE_TORRENT} status="downloading" disabled={disabled} />, { wrapper: ToastProvider })
  return screen.getByRole('region', { name: /Files/ })
}

beforeEach(() => {
  vi.resetAllMocks()
  getTorrentFiles.mockResolvedValue([
    { index: 0, name: 'Dune.Part.Two/Dune.Part.Two.mkv', size: 19_900_000_000, progress: 0.4, priority: 1 },
    { index: 1, name: 'Dune.Part.Two/Extras.mkv', size: 1_500_000_000, progress: 0, priority: 0 },
  ])
  setFilePriority.mockResolvedValue()
})

describe('TorrentFiles', () => {
  it('shows a loading state, then the files with their progress and count', async () => {
    const files = renderFiles()
    expect(within(files).getByRole('status', { name: saying('Loading files') })).toBeInTheDocument()
    expect(files).toHaveAttribute('aria-busy', 'true')

    expect(await within(files).findByText('Dune.Part.Two.mkv')).toBeInTheDocument()
    expect(files).toHaveAttribute('aria-busy', 'false')
    expect(within(files).getByRole('heading', { name: /Files/ })).toHaveTextContent('Files 2')
    expect(within(files).getByRole('progressbar', { name: 'Dune.Part.Two.mkv: progress' })).toHaveAttribute('aria-valuenow', '40')
    expect(within(files).getByText('40% · 19.9 GB')).toBeInTheDocument()
  })

  it('changes a file’s priority', async () => {
    const files = renderFiles()
    const extras = await within(files).findByRole('combobox', { name: 'Priority: Extras.mkv' })
    expect(extras).toHaveValue('skip')
    await userEvent.selectOptions(extras, 'high')
    expect(setFilePriority).toHaveBeenCalledWith('dune', [1], 6)
    expect(extras).toHaveValue('high')
  })

  it('turns a file’s priority off while its change is on its way, showing what’s being sent, and only that file’s', async () => {
    setFilePriority.mockReturnValue(new Promise(() => {}))
    const files = renderFiles()
    const extras = await within(files).findByRole('combobox', { name: 'Priority: Extras.mkv' })
    await userEvent.selectOptions(extras, 'high')
    expect(extras).toHaveValue('high')
    expect(extras).toBeDisabled()
    expect(extras).toHaveAttribute('aria-busy', 'true')
    expect(within(files).getByRole('combobox', { name: 'Priority: Dune.Part.Two.mkv' })).toBeEnabled()
  })

  it('reports a priority change qBittorrent refused, keeping the old one', async () => {
    setFilePriority.mockRejectedValue(new Error('offline'))
    const files = renderFiles()
    const main = await within(files).findByRole('combobox', { name: 'Priority: Dune.Part.Two.mkv' })
    await userEvent.selectOptions(main, 'skip')
    expect(await within(files).findByRole('alert', { name: saying('Couldn’t change the priority. Try again.') })).toBeInTheDocument()
    expect(main).toHaveValue('normal')
  })

  it('can’t change priorities while qBittorrent is unreachable', async () => {
    const files = renderFiles(true)
    expect(await within(files).findByRole('combobox', { name: 'Priority: Extras.mkv' })).toBeDisabled()
  })

  it('shows the folders as a tree, inside the torrent’s own folder, with each folder’s progress', async () => {
    getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Show/Season 1/Show.S01E01.mkv', size: 1e9, progress: 1, priority: 1 },
      { index: 1, name: 'Show/Season 2/Show.S02E01.mkv', size: 1e9, progress: 0, priority: 1 },
      { index: 2, name: 'Show/Sample.mkv', size: 1e6, progress: 0, priority: 0 },
    ])
    const files = renderFiles()
    expect(await within(files).findByRole('combobox', { name: 'Priority: Sample.mkv' })).toBeInTheDocument()
    expect(within(files).queryByRole('button', { name: /^Show/ })).not.toBeInTheDocument()

    const season2 = within(files).getByRole('button', { name: /Season 2/ })
    expect(season2).toHaveAttribute('aria-expanded', 'false')
    expect(season2).toHaveTextContent('1 file · 1.00 GB · 0%')
    expect(within(files).getByRole('button', { name: /Season 1/ })).toHaveTextContent('1 file · 1.00 GB · 100%')
    await userEvent.click(season2)
    expect(within(files).getByRole('combobox', { name: 'Priority: Show.S02E01.mkv' })).toBeInTheDocument()
    await userEvent.click(season2)
    expect(within(files).queryByRole('combobox', { name: 'Priority: Show.S02E01.mkv' })).not.toBeInTheDocument()
  })

  it('explains an empty list, as a magnet link has before its metadata arrives', async () => {
    getTorrentFiles.mockResolvedValue([])
    const files = renderFiles()
    expect(await within(files).findByText('The file list appears once the torrent’s metadata arrives from peers.')).toBeInTheDocument()
  })

  it('says when the list can’t be loaded at all', async () => {
    getTorrentFiles.mockRejectedValue(new TypeError('Failed to fetch'))
    const files = renderFiles()
    expect(await within(files).findByRole('alert', { name: saying('Couldn’t load the file list.') })).toBeInTheDocument()
    expect(within(files).queryByRole('status')).not.toBeInTheDocument()
  })
})
