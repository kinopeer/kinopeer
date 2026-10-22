import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { TorrentScreen } from './TorrentScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getMainData: vi.fn(),
    getTorrentTrackers: vi.fn(),
    getTorrentFiles: vi.fn(),
    setFilePriority: vi.fn(),
    startTorrents: vi.fn(),
    stopTorrents: vi.fn(),
    deleteTorrents: vi.fn(),
  }
})

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), searchTitles: vi.fn() }
})

const getMainData = vi.mocked(api.getMainData)
const getTorrentTrackers = vi.mocked(api.getTorrentTrackers)
const getTorrentFiles = vi.mocked(api.getTorrentFiles)
const setFilePriority = vi.mocked(api.setFilePriority)
const startTorrents = vi.mocked(api.startTorrents)
const stopTorrents = vi.mocked(api.stopTorrents)
const deleteTorrents = vi.mocked(api.deleteTorrents)

const DUNE: Partial<Torrent> = {
  name: 'Dune.Part.Two.2024.2160p.WEB-DL',
  state: 'downloading',
  progress: 0.42,
  size: 20_000_000_000,
  dlspeed: 4_300_000,
  upspeed: 120_000,
  eta: 720,
  ratio: 0.31,
  num_seeds: 12,
  num_complete: 340,
  num_leechs: 3,
  num_incomplete: 41,
  category: 'Movies',
  tags: 'tmdb:movie:693134',
  save_path: '/data/movies',
  added_on: 1_760_000_000,
  priority: 1,
}

function snapshot(fields: Partial<Torrent> = {}): MainData {
  return { rid: 1, full_update: true, torrents: { dune: { ...DUNE, ...fields } }, server_state: {} }
}

function Downloads() {
  const location = useLocation()
  return <p>Downloads list {JSON.stringify(location.state)}</p>
}

function renderScreen(hash = 'dune') {
  return render(
    <MemoryRouter initialEntries={['/', `/torrent/${hash}`]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<Downloads />} />
        <Route path="/torrent/:hash" element={<TorrentScreen onSessionLost={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  getMainData.mockResolvedValue(snapshot())
  vi.mocked(tmdb.getMovie).mockResolvedValue({
    id: 693134,
    title: 'Dune: Part Two',
    original_title: 'Dune: Part Two',
    release_date: '2024-02-27',
    poster_path: '/dune.jpg',
  } as Awaited<ReturnType<typeof tmdb.getMovie>>)
  getTorrentFiles.mockResolvedValue([
    { index: 0, name: 'Dune.Part.Two/Dune.Part.Two.mkv', size: 19_900_000_000, progress: 0.4, priority: 1 },
    { index: 1, name: 'Dune.Part.Two/Extras.mkv', size: 1_500_000_000, progress: 0, priority: 0 },
  ])
  setFilePriority.mockResolvedValue()
  startTorrents.mockResolvedValue()
  stopTorrents.mockResolvedValue()
  deleteTorrents.mockResolvedValue()
})

describe('TorrentScreen', () => {
  it('shows the TMDB title, status, progress and speeds', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.getByText('Dune.Part.Two.2024.2160p.WEB-DL')).toBeInTheDocument()
    expect(screen.getByText('Downloading')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('ETA 12 min')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })

  it('falls back to the release name before a TMDB match', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '', name: 'Some.Home.Video' }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue({ titles: [], page: 1, totalPages: 1 })
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Some.Home.Video' })).toBeInTheDocument()
  })

  it('says when the torrent is gone', async () => {
    renderScreen('missing')
    expect(await screen.findByRole('heading', { name: 'Torrent not found' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to downloads' }))
    expect(screen.getByText(/Downloads list/)).toBeInTheDocument()
  })

  it('pauses a running torrent and resumes a stopped one', async () => {
    const { unmount } = renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(stopTorrents).toHaveBeenCalledWith(['dune'])
    unmount()

    getMainData.mockResolvedValue(snapshot({ state: 'stoppedDL' }))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(startTorrents).toHaveBeenCalledWith(['dune'])
  })

  it('reports a failed action', async () => {
    stopTorrents.mockRejectedValue(new Error('offline'))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
  })

  it('explains an error state', async () => {
    getMainData.mockResolvedValue(snapshot({ state: 'missingFiles' }))
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The files are missing from the save path.')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('shows details and trackers when expanded', async () => {
    getTorrentTrackers.mockResolvedValue([
      { url: '** [DHT] **', status: 2, msg: '' },
      { url: 'http://bt.rutor.info:2710/announce', status: 2, msg: '' },
      { url: 'udp://opentor.net:6969', status: 4, msg: '' },
    ])
    renderScreen()
    const toggle = await screen.findByRole('button', { name: 'Details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling
    expect(value('Seeds / peers')).toHaveTextContent('12 (340) · 3 (41)')
    expect(value('Save path')).toHaveTextContent('/data/movies')
    expect(value('Category')).toHaveTextContent('Movies')
    expect(value('Info hash')).toHaveTextContent('dune')
    expect(await screen.findByText('bt.rutor.info, opentor.net')).toBeInTheDocument()
    expect(getTorrentTrackers).toHaveBeenCalledWith('dune')
  })

  it('deletes after confirmation, with files only when asked', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    expect(dialog).toHaveTextContent('“Dune: Part Two” will be removed from qBittorrent.')

    const files = within(dialog).getByRole('checkbox', { name: /Also delete files/ })
    expect(files).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(files)
    expect(within(dialog).getByText('Files are removed from disk permanently.')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(deleteTorrents).toHaveBeenCalledWith(['dune'], true)
    expect(await screen.findByText(/Downloads list/)).toHaveTextContent('"deleted":"files"')
  })

  it('keeps the torrent when the confirmation is cancelled', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(deleteTorrents).not.toHaveBeenCalled()
  })

  it('lists files with progress and changes their priority', async () => {
    renderScreen()
    const files = await screen.findByRole('region', { name: /Files/ })
    expect(await within(files).findByText('Dune.Part.Two.mkv')).toBeInTheDocument()
    expect(within(files).getByText('40% · 19.9 GB')).toBeInTheDocument()

    const extras = within(files).getByRole('combobox', { name: 'Priority: Extras.mkv' })
    expect(extras).toHaveValue('skip')
    await userEvent.selectOptions(extras, 'high')
    expect(setFilePriority).toHaveBeenCalledWith('dune', [1], 6)
    expect(extras).toHaveValue('high')
  })

  it('reports a priority change qBittorrent refused', async () => {
    setFilePriority.mockRejectedValue(new Error('offline'))
    renderScreen()
    const main = await screen.findByRole('combobox', { name: 'Priority: Dune.Part.Two.mkv' })
    await userEvent.selectOptions(main, 'skip')
    expect(await screen.findByText('Couldn’t change the priority. Try again.')).toBeInTheDocument()
    expect(main).toHaveValue('normal')
  })

  it('shows the torrent’s folders as a tree, inside its own folder', async () => {
    getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Show/Season 1/Show.S01E01.mkv', size: 1e9, progress: 1, priority: 1 },
      { index: 1, name: 'Show/Season 2/Show.S02E01.mkv', size: 1e9, progress: 0, priority: 1 },
      { index: 2, name: 'Show/Sample.mkv', size: 1e6, progress: 0, priority: 0 },
    ])
    renderScreen()
    const files = await screen.findByRole('region', { name: /Files/ })
    expect(await within(files).findByRole('combobox', { name: 'Priority: Sample.mkv' })).toBeInTheDocument()
    expect(within(files).queryByRole('button', { name: /^Show/ })).not.toBeInTheDocument()

    const season2 = within(files).getByRole('button', { name: /Season 2/ })
    expect(season2).toHaveAttribute('aria-expanded', 'false')
    expect(season2).toHaveTextContent('1 file · 1.00 GB · 0%')
    await userEvent.click(season2)
    expect(within(files).getByRole('combobox', { name: 'Priority: Show.S02E01.mkv' })).toBeInTheDocument()
    await userEvent.click(season2)
    expect(within(files).queryByRole('combobox', { name: 'Priority: Show.S02E01.mkv' })).not.toBeInTheDocument()
  })

  it('explains an empty file list of a magnet link', async () => {
    getTorrentFiles.mockResolvedValue([])
    renderScreen()
    expect(
      await screen.findByText('The file list appears once the torrent’s metadata arrives from peers.'),
    ).toBeInTheDocument()
  })
})
