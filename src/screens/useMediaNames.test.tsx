import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent, TorrentFile } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { DUNE_TORRENT, duneFiles, duneTorrent, torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { readTorrentFile } from '../torrents/torrentFile'
import type { TitleMatch } from '../torrents/titleLookup'
import { useMediaNames } from './useMediaNames'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTorrentFiles: vi.fn(),
  exportTorrent: vi.fn(),
  renameFiles: vi.fn(),
}))

const getTorrentFiles = vi.mocked(api.getTorrentFiles)
const exportTorrent = vi.mocked(api.exportTorrent)
const renameFiles = vi.mocked(api.renameFiles)

const DUNE_MATCH: TitleMatch = { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, posterPath: null }
const NAMED = 'Dune - Part Two (2024)'
const RELEASE = DUNE_TORRENT.name
let DUNE: Torrent

/** The Dune torrent's files as naming leaves them: the folder and the video named, with the subtitles and the .nfo named after it. */
function namedFiles(): TorrentFile[] {
  return duneFiles().map((file, index) => ({
    ...file,
    name: [
      `${NAMED}/${NAMED}.mkv`,
      `${NAMED}/${NAMED}.ru.forced.srt`,
      `${NAMED}/${NAMED}.nfo`,
      `${NAMED}/Sample/${RELEASE}-sample.mkv`,
    ][index],
  }))
}

function Harness({ torrents, match }: { torrents: Record<string, Torrent>; match: TitleMatch | null }) {
  const names = useMediaNames({ torrents, offline: false, matchOf: () => match })
  return (
    <section aria-label="Screen">
      {Object.keys(torrents).map((hash) => (
        <button key={hash} type="button" onClick={() => names.open(hash)}>
          Open {hash}
        </button>
      ))}
      {names.element}
    </section>
  )
}

function renderNames(match: TitleMatch | null = DUNE_MATCH) {
  render(<Harness torrents={{ [DUNE.hash]: DUNE }} match={match} />, { wrapper: ToastProvider })
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${DUNE.hash}` }))
    return screen.getByRole('dialog', { name: 'Name for a media server' })
  }
  return { open }
}

beforeAll(async () => {
  // The torrent as qBittorrent has it: its hash is the one its exported metadata hashes to.
  const meta = await readTorrentFile(duneTorrent())
  DUNE = torrent(meta.infoHash, { name: RELEASE })
})

beforeEach(() => {
  vi.resetAllMocks()
  getTorrentFiles.mockResolvedValue(duneFiles())
  exportTorrent.mockImplementation(() => Promise.resolve(duneTorrent().slice().buffer))
  renameFiles.mockResolvedValue()
})

describe('useMediaNames', () => {
  it('shows the folder and the files naming renames, renames them, closes and says so', async () => {
    const { open } = renderNames()
    const sheet = await open()
    const folder = await within(sheet).findByRole('region', { name: 'Folder' })
    expect(within(sheet).queryByText('Couldn’t reach qBittorrent. Try again.')).not.toBeInTheDocument()
    // Naming, not the way back: no Back, and the original names were read.
    expect(within(sheet).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/can’t be restored/)).not.toBeInTheDocument()
    expect(folder).toHaveTextContent(`${RELEASE}becomes ${NAMED}`)
    const files = within(within(sheet).getByRole('region', { name: 'Files' })).getAllByRole('listitem')
    expect(files.map((item) => item.textContent)).toEqual([
      `${RELEASE}.mkvbecomes ${NAMED}.mkv`,
      `${RELEASE}.ru.forced.srtbecomes ${NAMED}.ru.forced.srt`,
      `${RELEASE}.nfobecomes ${NAMED}.nfo`,
    ])
    expect(within(sheet).getByText('Other files keep their names and stay with the movie, in its folder.')).toBeInTheDocument()
    expect(getTorrentFiles).toHaveBeenCalledWith(DUNE.hash, expect.any(AbortSignal))
    // The names are the metadata's: nothing to restore.
    expect(within(sheet).queryByRole('button', { name: 'Restore original names' })).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
    expect(renameFiles).toHaveBeenCalledWith(DUNE.hash, [
      { from: `${RELEASE}/${RELEASE}.mkv`, to: `${NAMED}/${NAMED}.mkv` },
      { from: `${RELEASE}/${RELEASE}.ru.forced.srt`, to: `${NAMED}/${NAMED}.ru.forced.srt` },
      { from: `${RELEASE}/${RELEASE}.nfo`, to: `${NAMED}/${NAMED}.nfo` },
      { from: `${RELEASE}/Sample/${RELEASE}-sample.mkv`, to: `${NAMED}/Sample/${RELEASE}-sample.mkv` },
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status', { name: saying('Files of “Dune: Part Two” named for a media server') })).toBeInTheDocument()
  })

  it('says the files are named already, and offers their original names back', async () => {
    getTorrentFiles.mockResolvedValue(namedFiles())
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('status', { name: saying('The files are named for a media server already') })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore original names' }))
    const restore = screen.getByRole('dialog', { name: 'Restore original names' })
    // The way back alone: no preview of naming, no way to it but Back.
    expect(within(restore).queryByRole('region', { name: 'Folder' })).not.toBeInTheDocument()
    expect(within(restore).queryByRole('status', { name: saying('The files are named for a media server already') })).not.toBeInTheDocument()
    expect(within(restore).queryByRole('button', { name: 'Restore original names' })).not.toBeInTheDocument()
    expect(within(restore).getAllByRole('listitem').map((item) => item.textContent)).toContain(`${NAMED}/${NAMED}.mkvbecomes ${RELEASE}/${RELEASE}.mkv`)
    await userEvent.click(within(restore).getByRole('button', { name: 'Restore' }))
    expect(renameFiles).toHaveBeenCalledWith(DUNE.hash, [
      { from: `${NAMED}/${NAMED}.mkv`, to: `${RELEASE}/${RELEASE}.mkv` },
      { from: `${NAMED}/${NAMED}.ru.forced.srt`, to: `${RELEASE}/${RELEASE}.ru.forced.srt` },
      { from: `${NAMED}/${NAMED}.nfo`, to: `${RELEASE}/${RELEASE}.nfo` },
      { from: `${NAMED}/Sample/${RELEASE}-sample.mkv`, to: `${RELEASE}/Sample/${RELEASE}-sample.mkv` },
    ])
    expect(await screen.findByRole('status', { name: saying('Original names of “Dune: Part Two” restored') })).toBeInTheDocument()
  })

  it('goes back from the original names to naming without sending anything', async () => {
    getTorrentFiles.mockResolvedValue(namedFiles())
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Restore original names' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    const again = screen.getByRole('dialog', { name: 'Name for a media server' })
    expect(within(again).getByRole('status', { name: saying('The files are named for a media server already') })).toBeInTheDocument()
    expect(within(again).queryByRole('list')).not.toBeInTheDocument()
    expect(renameFiles).not.toHaveBeenCalled()
  })

  it('says it reads the files until qBittorrent answers, and offers nothing meanwhile', async () => {
    let answer!: (files: TorrentFile[]) => void
    getTorrentFiles.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { open } = renderNames()
    const sheet = await open()
    expect(within(sheet).getByText('Reading the files…')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    await act(async () => answer(duneFiles()))
    expect(within(sheet).queryByText('Reading the files…')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  })

  it('shows the folder alone when the files are named already but their folder isn’t', async () => {
    getTorrentFiles.mockResolvedValue([{ index: 0, name: `${RELEASE}/${NAMED}.mkv`, size: 18e9, progress: 1, priority: 1 }])
    exportTorrent.mockRejectedValue(new Error('no metadata'))
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('region', { name: 'Folder' })).toHaveTextContent(`${RELEASE}becomes ${NAMED}`)
    expect(within(sheet).queryByRole('region', { name: 'Files' })).not.toBeInTheDocument()
  })

  it('says why the files aren’t named, and renames nothing', async () => {
    getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Dune/CD1.avi', size: 7e8, progress: 1, priority: 1 },
      { index: 1, name: 'Dune/CD2.avi', size: 7e8, progress: 1, priority: 1 },
    ])
    exportTorrent.mockRejectedValue(new api.QbittorrentError('Missing metadata', 409))
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('status', { name: saying(/^The files can’t be named.*Several large videos/) })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
  })

  it('still names the files when the original names can’t be read, and says they can’t be restored', async () => {
    getTorrentFiles.mockResolvedValue(namedFiles().map((file, index) => (index === 0 ? { ...file, name: `${NAMED}/Other.mkv` } : file)))
    exportTorrent.mockRejectedValue(new api.QbittorrentError('Missing metadata', 409))
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByText('Couldn’t read the original names from qBittorrent, so they can’t be restored.')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeEnabled()
    expect(within(sheet).queryByRole('button', { name: 'Restore original names' })).not.toBeInTheDocument()
  })

  it('takes no names back from metadata that isn’t this torrent’s', async () => {
    getTorrentFiles.mockResolvedValue(namedFiles())
    exportTorrent.mockImplementation(() => Promise.resolve(duneTorrent().slice().buffer))
    const other = torrent('f'.repeat(40), { name: RELEASE })
    render(<Harness torrents={{ [other.hash]: other }} match={DUNE_MATCH} />, { wrapper: ToastProvider })
    await userEvent.click(screen.getByRole('button', { name: `Open ${other.hash}` }))
    const sheet = screen.getByRole('dialog', { name: 'Name for a media server' })
    expect(await within(sheet).findByText(/so they can’t be restored/)).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Restore original names' })).not.toBeInTheDocument()
  })

  it('keeps the sheet open with the failure and lists the names qBittorrent has now', async () => {
    renameFiles.mockRejectedValue(new api.QbittorrentError('The file already exists', 409))
    const { open } = renderNames()
    const sheet = await open()
    getTorrentFiles.mockResolvedValue(namedFiles().map((file, index) => (index === 0 ? file : duneFiles()[index])))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent didn’t rename every file. The list shows the names it has now.') })).toBeInTheDocument()
    await waitFor(() => expect(getTorrentFiles).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status', { name: saying(/Couldn’t rename/) })).not.toBeInTheDocument()
  })

  it('says a failure in a toast once the sheet is closed', async () => {
    let refuse = () => {}
    renameFiles.mockReturnValue(new Promise((_, reject) => (refuse = () => reject(new Error('500')))))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeDisabled()
    // Escape, which jsdom doesn't turn into the dialog's cancel event.
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    refuse()
    expect(await screen.findByRole('status', { name: saying('Couldn’t rename the files of “Dune: Part Two”') })).toBeInTheDocument()
  })

  it('shows the renames in flight in a sheet opened again, and sends nothing more', async () => {
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    const again = await open()
    expect(await within(again).findByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(renameFiles).toHaveBeenCalledTimes(1)
  })

  it('says qBittorrent didn’t answer with the files, and asks again on Try again', async () => {
    getTorrentFiles.mockRejectedValueOnce(new api.QbittorrentError('down', 502))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Try again' }))
    expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
  })

  it('opens nothing for a torrent that isn’t matched to a movie', async () => {
    renderNames({ ...DUNE_MATCH, type: 'tv' })
    await userEvent.click(screen.getByRole('button', { name: `Open ${DUNE.hash}` }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
