import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import { parseRelease } from '../releases/parseRelease'
import { getSettings, resetSettings } from '../settings/settings'
import { mainData, torrent } from '../test/fixtures'
import { qbittorrentDown, renderWithRouter, saying } from '../test/render'
import { MainDataProvider } from '../torrents/MainDataProvider'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import * as serverMatches from '../torrents/serverMatches'
import * as torrentFile from '../torrents/torrentFile'
import { AddReleaseSheet } from './AddReleaseSheet'

vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  fetchRelease: vi.fn(),
}))
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getSaveLocations: vi.fn(),
  getMainData: vi.fn(),
  getTorrents: vi.fn(),
  deleteTorrents: vi.fn(),
}))
vi.mock('../torrents/torrentFile', async (importOriginal) => ({
  ...(await importOriginal<typeof torrentFile>()),
  readTorrentFile: vi.fn(),
}))
vi.mock('../torrents/serverMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof serverMatches>()),
  forgetMatches: vi.fn(),
}))

const getMainData = vi.mocked(qbt.getMainData)
const deleteTorrents = vi.mocked(qbt.deleteTorrents)

const RELEASE: Release = {
  id: 'bb',
  title: 'Breaking.Bad.S01-S02.1080p.BluRay.x264',
  indexer: 'Indexer C',
  size: 50e9,
  seeders: 486,
  categories: [5000],
  download: '1/download?link=bb',
  infoUrl: 'https://tracker.example.org/bb',
}
const META = {
  infoHash: 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10e9 },
    { path: 'Season 2/e01.mkv', size: 20e9 },
    { path: 'Season 2/e02.mkv', size: 20e9 },
  ],
  totalSize: 50e9,
}

// 40 GB free and a 50 GB download: 10 GB short.
const FREE = 40e9
const MOVIE = torrent('movie', { name: 'Movie.2024.2160p-GRPA', size: 30e9, progress: 1, save_path: '/data/movies', added_on: 300, ratio: 0.4 })
const HALF = torrent('half', { name: 'Show.S01.1080p-GRPB', size: 24e9, progress: 0.5, save_path: '/data', added_on: 100, ratio: 2 })
const EPISODE = torrent('episode', { name: 'Show.S02E01.720p-GRPC', size: 4e9, progress: 1, save_path: '/data/tv', added_on: 200, ratio: 1 })
const ARCHIVE = torrent('archive', { name: 'Archive.1999.1080p-GRPD', size: 60e9, progress: 1, save_path: '/mnt/archive', added_on: 50, ratio: 5 })
const TORRENTS = [EPISODE, ARCHIVE, HALF, MOVIE]

function renderSheet() {
  return renderWithRouter(
    <MainDataProvider onUnauthorized={vi.fn()}>
      <TorrentRequestsProvider>
        <AddReleaseSheet
          release={RELEASE}
          info={parseRelease(RELEASE.title)}
          title={{ type: 'tv', id: 1396, name: 'Breaking Bad', posterPath: null }}
          onClose={vi.fn()}
          onAdded={vi.fn()}
        />
      </TorrentRequestsProvider>
    </MainDataProvider>,
  )
}

const addSheet = () => screen.getByRole('dialog', { name: 'Add to downloads' })
const step = () => screen.getByRole('dialog', { name: 'Free up space' })
const names = (list: HTMLElement) => within(list).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))

/** Opens Free up space from the add sheet's warning. */
async function openStep() {
  const warning = await within(addSheet()).findByRole('status', { name: saying(/^Not enough free space/) })
  await userEvent.click(within(warning).getByRole('button', { name: 'Free up space' }))
  return step()
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(prowlarr.fetchRelease).mockResolvedValue({ kind: 'torrent', file: new File([new Uint8Array([1])], 'bb.torrent') })
  vi.mocked(torrentFile.readTorrentFile).mockResolvedValue(META)
  vi.mocked(qbt.getSaveLocations).mockResolvedValue({
    categories: [],
    defaultPath: '/data',
    categoryPaths: true,
    subcategories: false,
    relocateOnCategoryChange: true,
    downloadPath: false,
  })
  vi.mocked(qbt.getTorrents).mockResolvedValue([])
  // qBittorrent's torrents, which a delete takes away; it measures the free space on its own timer.
  let present = TORRENTS
  getMainData.mockImplementation(async () => mainData(present, { free_space_on_disk: FREE }))
  deleteTorrents.mockImplementation(async (hashes) => {
    present = present.filter((item) => !hashes.includes(item.hash))
  })
})

describe('Free up space', () => {
  it('lists the torrents on the default save path’s disk by what they have on it, the rest apart', async () => {
    renderSheet()
    const sheet = await openStep()
    const [counted, elsewhere] = within(sheet).getAllByRole('list')
    // Half is the larger torrent, but has 12 GB of it.
    expect(names(counted)).toEqual(['Movie.2024.2160p-GRPA', 'Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC'])
    expect(within(counted).getAllByRole('listitem')[1]).toHaveTextContent(/12\.0\sGB · .+ · Ratio 2\.00/)
    const group = within(sheet).getByRole('region', { name: 'May be on another disk' })
    expect(group).toContainElement(elsewhere)
    expect(names(elsewhere)).toEqual(['Archive.1999.1080p-GRPD'])
    expect(within(sheet).getByText(/^Selected 0\sB of 10\.0\sGB needed$/)).toBeInTheDocument()
    expect(within(sheet).getByText(/^40\.0\sGB free$/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('counts only the torrents on the default save path’s disk toward the space needed', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Archive.1999.1080p-GRPD' }))
    expect(within(sheet).getByText(/^Selected 0\sB of 10\.0\sGB needed$/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Show.S01.1080p-GRPB' }))
    expect(within(sheet).getByText(/^Selected 12\.0\sGB of 10\.0\sGB needed$/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('remembers its own sort, apart from Downloads’', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Date' }))
    // The oldest first, which is the usual direction for a date here.
    expect(names(within(sheet).getAllByRole('list')[0])).toEqual(['Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC', 'Movie.2024.2160p-GRPA'])
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ascending' }))
    expect(names(within(sheet).getAllByRole('list')[0])).toEqual(['Movie.2024.2160p-GRPA', 'Show.S02E01.720p-GRPC', 'Show.S01.1080p-GRPB'])
    expect(getSettings()).toMatchObject({ freeUpSort: 'added', freeUpSortDescending: true, downloadsSort: 'priority' })
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Ratio' }))
    expect(names(within(sheet).getAllByRole('list')[0])).toEqual(['Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC', 'Movie.2024.2160p-GRPA'])
  })

  it('deletes with the files, then shows the free space with what was freed as an estimate until qBittorrent measures again', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Archive.1999.1080p-GRPD' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))

    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrents?' })
    // The files go: said, not asked.
    expect(within(confirm).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(confirm).getByText(/^Files are deleted too · 90\.0\sGB$/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(deleteTorrents).toHaveBeenCalledWith(['movie', 'archive'], true)

    // qBittorrent still reports 40 GB: the archive may be on another disk, so only the movie's 30 GB count.
    expect(await within(step()).findByText(/^≈ 70\.0\sGB free$/)).toBeInTheDocument()
    expect(within(step()).getByText('Enough space for this download')).toBeInTheDocument()
    expect(names(within(step()).getAllByRole('list')[0])).toEqual(['Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC'])
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))

    const back = addSheet()
    expect(within(back).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(back).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/≈ 70\.0\sGB free/)
  })

  it('shows qBittorrent’s own figure once it reports another', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Show.S02E01.720p-GRPC' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect(await within(step()).findByText(/^≈ 44\.0\sGB free$/)).toBeInTheDocument()
    // Still short: the warning says so with the estimate.
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))
    expect(
      await within(addSheet()).findByRole('status', { name: saying(/^Not enough free space ?≈ 44\.0\sGB free on qBittorrent’s disk, 6\.00\sGB short/) }),
    ).toBeInTheDocument()

    getMainData.mockResolvedValue({ rid: 2, server_state: { free_space_on_disk: 43e9 } })
    await waitFor(() => expect(within(addSheet()).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/· 43\.0\sGB free/), {
      timeout: 4000,
    })
  })

  it('counts a delete that qBittorrent answers after Back', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = () => resolve())))
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))

    await act(async () => answer())
    expect(await within(addSheet()).findByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/≈ 70\.0\sGB free/)
    expect(within(addSheet()).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it('opens from the file picker too, and goes back to it', async () => {
    renderSheet()
    await userEvent.click(await within(addSheet()).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(await within(picker).findByRole('button', { name: 'Free up space' }))
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Select files' })).toBeInTheDocument()
  })

  it('offers no delete while qBittorrent doesn’t answer, and says so', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    getMainData.mockRejectedValue(qbittorrentDown())
    await waitFor(() => expect(within(step()).getByRole('button', { name: 'Delete' })).toBeDisabled(), { timeout: 4000 })
    expect(within(step()).getByRole('alert', { name: saying(/^Couldn’t reach qBittorrent/) })).toBeInTheDocument()
  })

  it('says when qBittorrent has no torrents', async () => {
    getMainData.mockResolvedValue(mainData([], { free_space_on_disk: FREE }))
    renderSheet()
    const sheet = await openStep()
    expect(within(sheet).getByText('No downloads yet')).toBeInTheDocument()
    expect(within(sheet).queryByRole('list')).not.toBeInTheDocument()
  })
})
