import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  multiFile: true,
}

// 40 GB free and a 50 GB download: 10 GB short.
const FREE = 40e9
// The time the tests run at, pinned, so a row's age reads the same every time.
const NOW = Date.UTC(2026, 10, 23, 12)
/** Seconds since the epoch, as qBittorrent's `added_on`, that many days before `NOW`. */
const daysAgo = (days: number) => NOW / 1000 - days * 86_400
const MOVIE = torrent('movie', { name: 'Movie.2024.2160p-GRPA', size: 30e9, progress: 1, save_path: '/data/movies', content_path: '/data/movies/movie', added_on: daysAgo(1), ratio: 0.4 })
const HALF = torrent('half', { name: 'Show.S01.1080p-GRPB', size: 24e9, progress: 0.5, save_path: '/data', content_path: '/data/half', added_on: daysAgo(3), ratio: 2 })
// qBittorrent reports 0 when it doesn't know when a torrent was added.
const EPISODE = torrent('episode', { name: 'Show.S02E01.720p-GRPC', size: 4e9, progress: 1, save_path: '/data/tv', content_path: '/data/tv/episode', added_on: 0, ratio: 1 })
const ARCHIVE = torrent('archive', { name: 'Archive.1999.1080p-GRPD', size: 60e9, progress: 1, save_path: '/mnt/archive', content_path: '/mnt/archive/archive', added_on: daysAgo(9), ratio: 5 })
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

/** Has the poll ask qBittorrent now rather than at its next turn, as it does when the device comes back online. */
const pollNow = () => act(async () => void window.dispatchEvent(new Event('online')))

/** Opens Free up space from the add sheet's warning. */
async function openStep() {
  const warning = await within(addSheet()).findByRole('status', { name: saying(/^Not enough free space/) })
  await userEvent.click(within(warning).getByRole('button', { name: 'Free up space' }))
  // A step in place of the sheet, not over it.
  expect(screen.queryByRole('dialog', { name: 'Add to downloads' })).not.toBeInTheDocument()
  return step()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
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

afterEach(() => {
  vi.useRealTimers()
})

describe('Free up space', () => {
  it('lists the torrents on the default save path’s disk by what they have on it, the rest apart', async () => {
    renderSheet()
    const sheet = await openStep()
    const [counted, elsewhere] = within(sheet).getAllByRole('list')
    expect(names(counted)).toEqual(['Movie.2024.2160p-GRPA', 'Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC'])
    const rows = within(counted).getAllByRole('listitem')
    expect(rows[1]).toHaveTextContent(/^Show\.S01\.1080p-GRPB12\.0\sGB · 3\sd · Ratio 2\.00$/)
    // No date added where qBittorrent doesn't know it.
    expect(rows[2]).toHaveTextContent(/^Show\.S02E01\.720p-GRPC4\.00\sGB · Ratio 1\.00$/)
    expect(within(sheet).queryByText('No downloads yet')).not.toBeInTheDocument()
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
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    expect(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' })).toHaveAttribute('aria-checked', 'false')
    expect(within(sheet).getByText(/^Selected 12\.0\sGB of 10\.0\sGB needed$/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('remembers its own sort, apart from Downloads’', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Date' }))
    // The orders themselves (oldest first, an unknown date last, the ratio) are `freeUpSpace.test.ts`'s; this checks the sheet's wiring: the pick and the direction reach the list and are kept under their own keys.
    expect(names(within(sheet).getAllByRole('list')[0])).toEqual(['Show.S01.1080p-GRPB', 'Movie.2024.2160p-GRPA', 'Show.S02E01.720p-GRPC'])
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ascending' }))
    expect(names(within(sheet).getAllByRole('list')[0])).toEqual(['Movie.2024.2160p-GRPA', 'Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC'])
    expect(getSettings()).toMatchObject({ freeUpSort: 'added', freeUpSortDescending: true, downloadsSort: 'priority' })
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

  // `freeUpSpace.test.ts` owns the rule (the held figure against a new one); this is the sheet following it through the poll, in the warning and on the Files button.
  it('shows qBittorrent’s own figure once it reports another', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Show.S02E01.720p-GRPC' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    // Named as the list names it.
    expect(screen.getByRole('alertdialog')).toHaveTextContent('“Show.S02E01.720p-GRPC” will be removed from qBittorrent.')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect(await within(step()).findByText(/^≈ 44\.0\sGB free$/)).toBeInTheDocument()
    // Still short: the warning says so with the estimate.
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))
    expect(
      await within(addSheet()).findByRole('status', { name: saying(/^Not enough free space ?≈ 44\.0\sGB free on qBittorrent’s disk, 6\.00\sGB short/) }),
    ).toBeInTheDocument()

    getMainData.mockResolvedValue({ rid: 2, server_state: { free_space_on_disk: 43e9 } })
    await pollNow()
    await waitFor(() => expect(within(addSheet()).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/· 43\.0\sGB free/))
    // Back at the figure the delete was held against, it's qBittorrent's own: the hold went with the new figure.
    getMainData.mockResolvedValue({ rid: 3, server_state: { free_space_on_disk: FREE } })
    await pollNow()
    await waitFor(() => expect(within(addSheet()).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/· 40\.0\sGB free/))
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
    const season = () => within(screen.getByRole('dialog', { name: 'Select files' })).getByRole('button', { name: /^Season 2/ })
    expect(season()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(season())
    await userEvent.click(await within(picker).findByRole('button', { name: 'Free up space' }))
    await userEvent.click(within(step()).getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Select files' })).toBeInTheDocument()
    // Its folders as they were left.
    expect(season()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('dialog', { name: 'Free up space' })).not.toBeInTheDocument()
    // Offered only while the selection doesn't fit: 10 GB of Season 1 does.
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Select files' })).getByRole('checkbox', { name: 'Season 2' }))
    expect(within(screen.getByRole('dialog', { name: 'Select files' })).queryByRole('button', { name: 'Free up space' })).not.toBeInTheDocument()
  })

  it('offers no delete while qBittorrent doesn’t answer, and says so', async () => {
    renderSheet()
    const sheet = await openStep()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    getMainData.mockRejectedValue(qbittorrentDown())
    await pollNow()
    await waitFor(() => expect(within(step()).getByRole('button', { name: 'Delete' })).toBeDisabled())
    expect(within(step()).getByRole('alert', { name: saying(/^Couldn’t reach qBittorrent/) })).toBeInTheDocument()
  })

  it('lists every torrent as maybe elsewhere, counting none, while qBittorrent’s default folder isn’t known', async () => {
    // The client answers an empty default save path when qBittorrent didn't send one.
    const locations = await qbt.getSaveLocations()
    vi.mocked(qbt.getSaveLocations).mockResolvedValue({ ...locations, defaultPath: '' })
    renderSheet()
    const sheet = await openStep()
    const elsewhere = within(sheet).getByRole('region', { name: 'May be on another disk' })
    expect(within(elsewhere).getByText('qBittorrent’s default folder isn’t known, so none of them count.')).toBeInTheDocument()
    expect(within(elsewhere).queryByText('Outside qBittorrent’s default folder, so not counted.')).not.toBeInTheDocument()
    expect(names(within(elsewhere).getByRole('list'))).toEqual([
      'Archive.1999.1080p-GRPD',
      'Movie.2024.2160p-GRPA',
      'Show.S01.1080p-GRPB',
      'Show.S02E01.720p-GRPC',
    ])
    await userEvent.click(within(elsewhere).getByRole('checkbox', { name: 'Movie.2024.2160p-GRPA' }))
    expect(within(sheet).getByText(/^Selected 0\sB of 10\.0\sGB needed$/)).toBeInTheDocument()
  })

  it('groups the torrents once the default folder arrives', async () => {
    const locations = await qbt.getSaveLocations()
    let answer = () => {}
    vi.mocked(qbt.getSaveLocations).mockReturnValue(new Promise((resolve) => (answer = () => resolve(locations))))
    renderSheet()
    const sheet = await openStep()
    expect(within(sheet).getByText('qBittorrent’s default folder isn’t known, so none of them count.')).toBeInTheDocument()
    await act(async () => answer())
    const elsewhere = within(step()).getByRole('region', { name: 'May be on another disk' })
    expect(within(elsewhere).getByText('Outside qBittorrent’s default folder, so not counted.')).toBeInTheDocument()
    expect(within(elsewhere).queryByText('qBittorrent’s default folder isn’t known, so none of them count.')).not.toBeInTheDocument()
    expect(names(within(step()).getAllByRole('list')[0])).toEqual(['Movie.2024.2160p-GRPA', 'Show.S01.1080p-GRPB', 'Show.S02E01.720p-GRPC'])
  })

  it('counts the whole download while qBittorrent can’t tell the free space', async () => {
    renderSheet()
    const sheet = await openStep()
    // qBittorrent reports 0 or less when it can't tell.
    getMainData.mockResolvedValue({ rid: 2, server_state: { free_space_on_disk: 0 } })
    await pollNow()
    expect(await within(sheet).findByText(/^Selected 0\sB of 50\.0\sGB needed$/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/free$/)).not.toBeInTheDocument()
  })

  it('lists torrents that are all elsewhere, without saying there are none', async () => {
    getMainData.mockResolvedValue(mainData([ARCHIVE], { free_space_on_disk: FREE }))
    renderSheet()
    const sheet = await openStep()
    expect(names(within(sheet).getByRole('list'))).toEqual(['Archive.1999.1080p-GRPD'])
    expect(within(sheet).queryByText('No downloads yet')).not.toBeInTheDocument()
  })

  it('says when qBittorrent has no torrents', async () => {
    getMainData.mockResolvedValue(mainData([], { free_space_on_disk: FREE }))
    renderSheet()
    const sheet = await openStep()
    expect(within(sheet).getByText('No downloads yet')).toBeInTheDocument()
    expect(within(sheet).queryByRole('list')).not.toBeInTheDocument()
  })
})
