import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent, TorrentFile } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { DUNE_TORRENT, duneFiles, duneTorrent, torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { readTorrentFile } from '../torrents/torrentFile'
import type { TitleMatch } from '../torrents/titleLookup'
import { RENAMES_SETTLE_MS } from './MediaNamesSheet'
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

function Harness({ torrents, match, offline = false }: { torrents: Record<string, Torrent>; match: TitleMatch | null; offline?: boolean }) {
  const names = useMediaNames({ torrents, offline, matchOf: () => match })
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

function renderNames(match: TitleMatch | null = DUNE_MATCH, torrents: Record<string, Torrent> = { [DUNE.hash]: DUNE }) {
  const view = render(<Harness torrents={torrents} match={match} />, { wrapper: ToastProvider })
  /** Opens the sheet for a torrent: the dialog, by whichever title it opens with. */
  const open = async (hash = DUNE.hash) => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${hash}` }))
    return screen.getByRole('dialog')
  }
  const rerender = (next: { torrents?: Record<string, Torrent>; offline?: boolean }) =>
    view.rerender(<Harness torrents={torrents} match={match} {...next} />)
  return { open, rerender }
}

/** The files with the first renamed already: naming renames the rest, and the way back is there too. */
function partlyNamedFiles(): TorrentFile[] {
  return namedFiles().map((file, index) => (index === 0 ? { ...file, name: `${NAMED}/Other.mkv` } : file))
}

/** Escape, which jsdom doesn't turn into the dialog's cancel event. */
const close = (sheet: HTMLElement) => fireEvent(sheet, new Event('cancel', { cancelable: true }))

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
    expect(within(sheet).getByRole('status', { name: saying('Reading the files…') })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    await act(async () => answer(duneFiles()))
    expect(within(sheet).queryByRole('status', { name: saying('Reading the files…') })).not.toBeInTheDocument()
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
    getTorrentFiles.mockResolvedValue(partlyNamedFiles())
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

  it('keeps the sheet open with the failure and lists the names qBittorrent has now, read once it has applied them', async () => {
    let refuse = () => {}
    renameFiles.mockReturnValue(new Promise((_, reject) => (refuse = () => reject(new api.QbittorrentError('The file already exists', 409)))))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    // qBittorrent took the video's rename, a moment after it answered.
    getTorrentFiles.mockResolvedValue(duneFiles().map((file, index) => (index === 0 ? { ...file, name: `${RELEASE}/${NAMED}.mkv` } : file)))
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    await act(async () => refuse())
    expect(within(sheet).getByRole('alert', { name: saying('qBittorrent didn’t rename every file. The list shows the names it has now.') })).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(RENAMES_SETTLE_MS - 1))
    expect(getTorrentFiles).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(1))
    expect(getTorrentFiles).toHaveBeenCalledTimes(2)
    // The video is named: only the folder is left, once the answer is in. Reading it hashes the export
    // with Web Crypto, which settles outside the microtask queue, so the test waits for it with real timers.
    vi.useRealTimers()
    expect(await within(sheet).findByRole('region', { name: 'Folder' })).toHaveTextContent(`${RELEASE}becomes ${NAMED}`)
    expect(within(sheet).queryByRole('region', { name: 'Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying(/Couldn’t rename/) })).not.toBeInTheDocument()
  })

  it('reads the files once as it opens, without renames that failed', async () => {
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    await act(async () => vi.advanceTimersByTime(RENAMES_SETTLE_MS * 2))
    expect(getTorrentFiles).toHaveBeenCalledTimes(1)
  })

  it('doesn’t read the files again for renames that failed once the renames are sent again first', async () => {
    let refuse = () => {}
    renameFiles
      .mockReturnValueOnce(new Promise((_, reject) => (refuse = () => reject(new api.QbittorrentError('The file already exists', 409)))))
      .mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    await act(async () => refuse())
    expect(within(sheet).getByRole('alert', { name: saying(/didn’t rename every file/) })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
    await act(async () => vi.advanceTimersByTime(RENAMES_SETTLE_MS))
    expect(renameFiles).toHaveBeenCalledTimes(2)
    expect(getTorrentFiles).toHaveBeenCalledTimes(1)
  })

  it('says a failure in a toast once the sheet is closed', async () => {
    let refuse = () => {}
    renameFiles.mockReturnValue(new Promise((_, reject) => (refuse = () => reject(new Error('500')))))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeDisabled()
    close(sheet)
    refuse()
    expect(await screen.findByRole('status', { name: saying('Couldn’t rename the files of “Dune: Part Two”') })).toBeInTheDocument()
  })

  it('shows the renames in flight in a sheet opened again, and sends nothing more', async () => {
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    close(sheet)
    const again = await open()
    expect(await within(again).findByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(renameFiles).toHaveBeenCalledTimes(1)
  })

  it('says qBittorrent didn’t answer with the files, and asks again on Try again', async () => {
    getTorrentFiles.mockRejectedValueOnce(new api.QbittorrentError('down', 502))
    const { open } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
  })

  it('shows the renames being sent in a sheet opened again, not the names qBittorrent has half applied', async () => {
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    close(sheet)
    // qBittorrent has applied every rename but the last.
    getTorrentFiles.mockResolvedValue(namedFiles().map((file, index) => (index === 3 ? duneFiles()[3] : file)))
    const again = await open()
    await waitFor(() => expect(within(again).getAllByRole('listitem')).toHaveLength(4))
    expect(within(again).getAllByRole('listitem')[0]).toHaveTextContent(`${RELEASE}/${RELEASE}.mkvbecomes ${NAMED}/${NAMED}.mkv`)
    expect(within(again).queryByRole('status', { name: saying('The files are named for a media server already') })).not.toBeInTheDocument()
    expect(within(again).queryByRole('region', { name: 'Folder' })).not.toBeInTheDocument()
    expect(within(again).getByRole('button', { name: 'Rename' })).toBeDisabled()
  })

  it('names nothing while another torrent is in the folder naming would use, and says which', async () => {
    const other = torrent('b'.repeat(40), { name: 'Dune.Part.Two.2024.1080p', save_path: DUNE.save_path, content_path: `${DUNE.save_path}/${NAMED}` })
    const { open } = renderNames(DUNE_MATCH, { [DUNE.hash]: DUNE, [other.hash]: other })
    const sheet = await open(DUNE.hash)
    expect(
      await within(sheet).findByRole('status', {
        name: saying(`Another torrent, “Dune.Part.Two.2024.1080p”, is in the folder “${NAMED}” already. Naming this one too would mix their files.`),
      }),
    ).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('region', { name: 'Folder' })).not.toBeInTheDocument()
  })

  it('can’t rename while qBittorrent is unreachable', async () => {
    const { open, rerender } = renderNames()
    const sheet = await open()
    expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
    rerender({ offline: true })
    expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeDisabled()
  })

  it('keeps the way back and Back off while renames are being sent', async () => {
    getTorrentFiles.mockResolvedValue(partlyNamedFiles())
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Restore original names' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore' }))
    expect(within(sheet).getByRole('button', { name: 'Restore' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('keeps the way back off while naming is being sent', async () => {
    getTorrentFiles.mockResolvedValue(partlyNamedFiles())
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    expect(within(sheet).getByRole('button', { name: 'Restore original names' })).toBeDisabled()
  })

  it('opens again on the way back while it’s being sent, with what’s sent, though the original names can’t be read now', async () => {
    getTorrentFiles.mockResolvedValue(namedFiles())
    renameFiles.mockReturnValue(new Promise(() => {}))
    const { open } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Restore original names' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore' }))
    close(sheet)
    exportTorrent.mockRejectedValue(new api.QbittorrentError('Missing metadata', 409))
    const again = await open()
    expect(again).toHaveAccessibleName('Restore original names')
    await waitFor(() => expect(within(again).getAllByRole('listitem')).toHaveLength(4))
    expect(within(again).getAllByRole('listitem')[0]).toHaveTextContent(`${NAMED}/${NAMED}.mkvbecomes ${RELEASE}/${RELEASE}.mkv`)
    expect(within(again).getByRole('button', { name: 'Restore' })).toBeDisabled()
    expect(within(again).queryByText(/can’t be restored/)).not.toBeInTheDocument()
    expect(renameFiles).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['went away', {}],
    ['was replaced by another with the same hash', () => ({ [DUNE.hash]: { ...DUNE, added_on: DUNE.added_on + 1 } })],
  ])('closes the sheet when its torrent %s, and says how the renames went in a toast', async (_case, next) => {
    let refuse = () => {}
    renameFiles.mockReturnValue(new Promise((_, reject) => (refuse = () => reject(new Error('500')))))
    const { open, rerender } = renderNames()
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Rename' }))
    rerender({ torrents: typeof next === 'function' ? next() : next })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    refuse()
    expect(await screen.findByRole('status', { name: saying('Couldn’t rename the files of “Dune: Part Two”') })).toBeInTheDocument()
  })

  it('keeps a torrent’s renames busy after another torrent’s renames started, so they aren’t sent twice', async () => {
    renameFiles.mockReturnValue(new Promise(() => {}))
    const other = torrent('a'.repeat(40), { name: RELEASE })
    const { open } = renderNames(DUNE_MATCH, { [DUNE.hash]: DUNE, [other.hash]: other })
    const dune = await open(DUNE.hash)
    await userEvent.click(await within(dune).findByRole('button', { name: 'Rename' }))
    close(dune)
    const second = await open(other.hash)
    await userEvent.click(await within(second).findByRole('button', { name: 'Rename' }))
    close(second)
    const again = await open(DUNE.hash)
    expect(await within(again).findByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(renameFiles).toHaveBeenCalledTimes(2)
  })

  describe('a series', () => {
    const BB: TitleMatch = { type: 'tv', id: 1396, title: 'Breaking Bad', year: 2008, posterPath: null }
    const SHOW = 'Breaking Bad (2008)'
    const PACK = 'Breaking.Bad.S02.1080p-GRPA'
    const file = (index: number, name: string): TorrentFile => ({ index, name, size: 700e6, progress: 1, priority: 1 })
    const season2 = torrent('s2'.repeat(20), { name: PACK, save_path: '/data/tv', content_path: `/data/tv/${PACK}` })
    const season1 = torrent('s1'.repeat(20), { name: SHOW, save_path: '/data/tv', content_path: `/data/tv/${SHOW}` })
    const own = [file(0, `${PACK}/Breaking.Bad.S02E01.mkv`), file(1, `${PACK}/Breaking.Bad.S02E02.mkv`), file(2, `${PACK}/Extras/Making of.mkv`)]

    beforeEach(() => {
      exportTorrent.mockRejectedValue(new api.QbittorrentError('Missing metadata', 409))
    })

    const filesBy = (theirs: TorrentFile[] | Error) => (hash: string) =>
      hash === season2.hash ? Promise.resolve(own) : theirs instanceof Error ? Promise.reject(theirs) : Promise.resolve(theirs)

    it('shows the episodes naming renames, and the videos whose episode it can’t read, and renames them', async () => {
      getTorrentFiles.mockImplementation(filesBy([]))
      const { open } = renderNames(BB, { [season2.hash]: season2 })
      const sheet = await open(season2.hash)
      expect(await within(sheet).findByRole('region', { name: 'Folder' })).toHaveTextContent(`${PACK}becomes ${SHOW}`)
      const files = within(within(sheet).getByRole('region', { name: 'Files' })).getAllByRole('listitem')
      expect(files.map((item) => item.textContent)).toEqual([
        `Breaking.Bad.S02E01.mkvbecomes Season 02/${SHOW} S02E01.mkv`,
        `Breaking.Bad.S02E02.mkvbecomes Season 02/${SHOW} S02E02.mkv`,
      ])
      // Below the torrent's folder, as the episodes are.
      const unread = within(within(sheet).getByRole('region', { name: 'Episode not read' })).getAllByRole('listitem')
      expect(unread.map((item) => item.textContent)).toEqual(['Extras/Making of.mkv'])
      expect(within(sheet).getByText('Other files keep their names and stay with the show, in its folder.')).toBeInTheDocument()
      await userEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
      expect(renameFiles).toHaveBeenCalledWith(season2.hash, [
        { from: own[0].name, to: `${SHOW}/Season 02/${SHOW} S02E01.mkv` },
        { from: own[1].name, to: `${SHOW}/Season 02/${SHOW} S02E02.mkv` },
        { from: own[2].name, to: `${SHOW}/Season 02/Extras/Making of.mkv` },
      ])
    })

    it('reads the season of an episode in no folder from the torrent’s name', async () => {
      const single = torrent('e3'.repeat(20), { name: 'Breaking.Bad.S04.1080p-GRPA', save_path: '/data/tv', content_path: '/data/tv/Episode 3.mkv' })
      getTorrentFiles.mockResolvedValue([file(0, 'Episode 3.mkv')])
      const { open } = renderNames(BB, { [single.hash]: single })
      const sheet = await open(single.hash)
      const files = within(await within(sheet).findByRole('region', { name: 'Files' })).getAllByRole('listitem')
      expect(files.map((item) => item.textContent)).toEqual([`Episode 3.mkvbecomes Season 04/${SHOW} S04E03.mkv`])
    })

    it('names a season into the show’s folder another season is in, reading that torrent’s files', async () => {
      getTorrentFiles.mockImplementation(filesBy([file(0, `${SHOW}/Season 01/${SHOW} S01E01.mkv`)]))
      const { open } = renderNames(BB, { [season2.hash]: season2, [season1.hash]: season1 })
      const sheet = await open(season2.hash)
      expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
      expect(getTorrentFiles).toHaveBeenCalledWith(season1.hash, expect.anything())
    })

    it.each([
      ['has a file naming would use', [file(0, `${SHOW}/Season 02/${SHOW} S02E01.mkv`)]],
      ['has files the sheet can’t read', new api.QbittorrentError('Not found', 404)],
    ])('names nothing where another torrent in the show’s folder %s', async (_, theirs) => {
      getTorrentFiles.mockImplementation(filesBy(theirs))
      const { open } = renderNames(BB, { [season2.hash]: season2, [season1.hash]: season1 })
      const sheet = await open(season2.hash)
      expect(
        await within(sheet).findByRole('status', {
          name: saying(`Another torrent, “${SHOW}”, is in the folder “${SHOW}”, and its files may be where naming would put this one’s.`),
        }),
      ).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    })

    it('finds a file of another torrent saved in the show’s folder itself, by its place on disk', async () => {
      const inside = torrent('s9'.repeat(20), { name: 'Season 02', save_path: `/data/tv/${SHOW}`, content_path: `/data/tv/${SHOW}/Season 02` })
      getTorrentFiles.mockImplementation((hash) => (hash === season2.hash ? Promise.resolve(own) : Promise.resolve([file(0, `Season 02/${SHOW} S02E01.mkv`)])))
      const { open } = renderNames(BB, { [season2.hash]: season2, [inside.hash]: inside })
      const sheet = await open(season2.hash)
      expect(
        await within(sheet).findByRole('status', {
          name: saying(`Another torrent, “Season 02”, is in the folder “${SHOW}”, and its files may be where naming would put this one’s.`),
        }),
      ).toBeInTheDocument()
    })

    it('looks for the other seasons in a “Show” folder for a title made only of what a name can’t take', async () => {
      const untitled: TitleMatch = { ...BB, title: '???' }
      const other = torrent('s8'.repeat(20), { name: 'Other season', save_path: '/data/tv', content_path: '/data/tv/Show (2008)' })
      getTorrentFiles.mockImplementation((hash) => (hash === season2.hash ? Promise.resolve(own) : Promise.resolve([file(0, 'Show (2008)/Season 02/Show (2008) S02E01.mkv')])))
      const { open } = renderNames(untitled, { [season2.hash]: season2, [other.hash]: other })
      const sheet = await open(season2.hash)
      expect(await within(sheet).findByRole('status', { name: saying(/^Another torrent, “Other season”, is in the folder “Show \(2008\)”/) })).toBeInTheDocument()
    })

    it('reads the files of a torrent that comes into the show’s folder while the sheet is open', async () => {
      getTorrentFiles.mockImplementation(filesBy([file(0, `${SHOW}/Season 02/${SHOW} S02E01.mkv`)]))
      const { open, rerender } = renderNames(BB, { [season2.hash]: season2 })
      const sheet = await open(season2.hash)
      expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
      rerender({ torrents: { [season2.hash]: season2, [season1.hash]: season1 } })
      expect(await within(sheet).findByRole('status', { name: saying(`Another torrent, “${SHOW}”, is in the folder “${SHOW}”, and its files may be where naming would put this one’s.`) })).toBeInTheDocument()
      expect(getTorrentFiles).toHaveBeenCalledWith(season1.hash, expect.anything())
    })

    it('reads a neighbour’s files again when it moves to another place in the show’s folder while the sheet is open', async () => {
      const away = torrent('s9'.repeat(20), { name: 'Season 02', save_path: `/data/tv/${SHOW}/Old`, content_path: `/data/tv/${SHOW}/Old/Season 02` })
      getTorrentFiles.mockImplementation((hash) => (hash === season2.hash ? Promise.resolve(own) : Promise.resolve([file(0, `Season 02/${SHOW} S02E01.mkv`)])))
      const { open, rerender } = renderNames(BB, { [season2.hash]: season2, [away.hash]: away })
      const sheet = await open(season2.hash)
      expect(await within(sheet).findByRole('button', { name: 'Rename' })).toBeEnabled()
      const moved = { ...away, save_path: `/data/tv/${SHOW}`, content_path: `/data/tv/${SHOW}/Season 02` }
      rerender({ torrents: { [season2.hash]: season2, [moved.hash]: moved } })
      expect(
        await within(sheet).findByRole('status', {
          name: saying(`Another torrent, “Season 02”, is in the folder “${SHOW}”, and its files may be where naming would put this one’s.`),
        }),
      ).toBeInTheDocument()
    })

    it('names nothing for a torrent a rename left partway, split between the show’s folder and its own, and offers the way back', async () => {
      // The Dune torrent's files with its video renamed into a show's folder, the rest not.
      exportTorrent.mockImplementation(() => Promise.resolve(duneTorrent().slice().buffer))
      getTorrentFiles.mockResolvedValue(duneFiles().map((file, index) => (index === 0 ? { ...file, name: `${SHOW}/Season 01/${SHOW} S01E01.mkv` } : file)))
      const { open } = renderNames(BB)
      const sheet = await open()
      expect(await within(sheet).findByRole('status', { name: saying(/^The files can’t be named.*Some of its files are in the show’s folder already/) })).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Restore original names' })).toBeEnabled()
    })

    it('reads no other torrent’s files for a movie, and lists no unread episodes', async () => {
      const other = torrent('b'.repeat(40), { name: 'Elsewhere', save_path: DUNE.save_path, content_path: `${DUNE.save_path}/Elsewhere` })
      const { open } = renderNames(DUNE_MATCH, { [DUNE.hash]: DUNE, [other.hash]: other })
      const sheet = await open(DUNE.hash)
      await within(sheet).findByRole('button', { name: 'Rename' })
      expect(getTorrentFiles).toHaveBeenCalledTimes(1)
      expect(within(sheet).queryByRole('region', { name: 'Episode not read' })).not.toBeInTheDocument()
    })

    it('reads no files of a torrent in a movie’s folder either: the movie names nothing', async () => {
      const other = torrent('b'.repeat(40), { name: 'Another copy', save_path: DUNE.save_path, content_path: `${DUNE.save_path}/${NAMED}` })
      const { open } = renderNames(DUNE_MATCH, { [DUNE.hash]: DUNE, [other.hash]: other })
      const sheet = await open(DUNE.hash)
      expect(await within(sheet).findByRole('status', { name: saying(/^Another torrent, “Another copy”/) })).toBeInTheDocument()
      expect(getTorrentFiles).toHaveBeenCalledTimes(1)
    })
  })

  it('opens nothing for a torrent that isn’t matched to a title', async () => {
    renderNames(null)
    await userEvent.click(screen.getByRole('button', { name: `Open ${DUNE.hash}` }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
