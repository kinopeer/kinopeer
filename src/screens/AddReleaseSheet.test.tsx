import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as adding from '../releases/addRelease'
import { parseRelease } from '../releases/parseRelease'
import { resetSettings, updateSettings } from '../settings/settings'
import * as torrentFile from '../torrents/torrentFile'
import { MainDataContext, createMainDataStore, type MainDataStore } from '../torrents/useMainData'
import { AddReleaseSheet } from './AddReleaseSheet'
import { qbittorrentDown, saying } from '../test/render'

vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  fetchRelease: vi.fn(),
}))
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getSaveLocations: vi.fn(),
  getMainData: vi.fn(),
}))
vi.mock('../releases/addRelease', () => ({ addRelease: vi.fn() }))
vi.mock('../torrents/torrentFile', async (importOriginal) => ({
  ...(await importOriginal<typeof torrentFile>()),
  readTorrentFile: vi.fn(),
}))

const fetchRelease = vi.mocked(prowlarr.fetchRelease)
const getMainData = vi.mocked(qbt.getMainData)
const commits = vi.fn()
const addRelease = vi.mocked(adding.addRelease)
const readTorrentFile = vi.mocked(torrentFile.readTorrentFile)

const RELEASE: Release = {
  id: 'bb',
  title: 'Breaking.Bad.S01-S02.1080p.BluRay.x264',
  indexer: 'Indexer C',
  size: 50e9,
  seeders: 486,
  categories: [5000],
  download: '1/download?link=bb',
  infoUrl: 'https://tracker.test/bb',
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

/** The app's shared poll, in use by a screen and answered once. */
async function runningPoll() {
  const store = createMainDataStore()
  onTestFinished(store.subscribe(() => {}))
  await waitFor(() => expect(store.getSnapshot().data).not.toBeNull())
  return store
}

function renderSheet(release = RELEASE, store?: MainDataStore) {
  const onAdded = vi.fn()
  const onClose = vi.fn()
  const { unmount } = render(
    <AddReleaseSheet
      release={release}
      info={parseRelease(release.title)}
      title={{ type: 'tv', id: 1396, name: 'Breaking Bad', posterPath: null }}
      onClose={onClose}
      onAdded={onAdded}
    />,
    {
      wrapper:
        store &&
        (({ children }: { children: ReactNode }) => (
          <MainDataContext value={store}>
            <Profiler id="sheet" onRender={commits}>
              {children}
            </Profiler>
          </MainDataContext>
        )),
    },
  )
  return { onAdded, onClose, unmount }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  fetchRelease.mockResolvedValue({ kind: 'torrent', file: FILE })
  readTorrentFile.mockResolvedValue(META)
  vi.mocked(qbt.getSaveLocations).mockResolvedValue({
    categories: [
      { name: 'Movies', savePath: '/data/movies' },
      { name: 'TV', savePath: '/data/tv' },
    ],
    defaultPath: '/data',
    categoryPaths: true,
    subcategories: false,
    relocateOnCategoryChange: true,
    downloadPath: false,
  })
  getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
  addRelease.mockResolvedValue()
})

describe('AddReleaseSheet', () => {
  it('picks files by season and adds the release to its category with the title tag', async () => {
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByText('Breaking Bad')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open on Indexer C' })).toHaveAttribute('href', 'https://tracker.test/bb')
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()

    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Season 1' }))
    await userEvent.click(within(picker).getByRole('button', { name: /Season 2/ }))
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'e02.mkv' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))

    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: 1 of 3/ })).toBeInTheDocument()
    await userEvent.click(within(back).getByRole('button', { name: /^Download · 20\.0\sGB$/ }))

    expect(addRelease).toHaveBeenCalledWith(
      { kind: 'torrent', file: FILE },
      {
        tags: ['tmdb:tv:1396'],
        category: 'TV',
        savePath: undefined,
        paused: false,
        sequential: false,
        firstLastPieces: false,
        topOfQueue: false,
      },
      { meta: META, skip: [0, 2] },
    )
    expect(onAdded).toHaveBeenCalled()
  })

  it('applies the chosen options', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'No category' }))
    // A path isn't a word, so the browser doesn't underline it.
    expect(within(sheet).getByLabelText('Save path')).toHaveAttribute('spellcheck', 'false')
    await userEvent.type(within(sheet).getByLabelText('Save path'), '/mnt/tv')
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Start paused' }))
    await userEvent.click(within(sheet).getByRole('switch', { name: 'First and last pieces first' }))
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Add to top of queue' }))
    expect(within(sheet).getByText('/mnt/tv')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))

    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      {
        tags: ['tmdb:tv:1396'],
        category: undefined,
        savePath: '/mnt/tv',
        paused: true,
        sequential: false,
        firstLastPieces: true,
        topOfQueue: true,
      },
      { meta: META, skip: [] },
    )
  })

  it('marks the category the torrent goes to', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    // A series goes to the category named like its type.
    const tv = await within(sheet).findByRole('button', { name: 'TV' })
    const none = within(sheet).getByRole('button', { name: 'No category' })
    expect(tv).toHaveAttribute('aria-pressed', 'true')
    expect(none).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(none)
    expect(none).toHaveAttribute('aria-pressed', 'true')
    expect(tv).toHaveAttribute('aria-pressed', 'false')
  })

  it('starts from the defaults in Settings', async () => {
    updateSettings({ tvCategory: 'Movies', startPaused: true, sequential: true, firstLastPieces: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('Movies → /data/movies')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: 'Movies', paused: true, sequential: true, firstLastPieces: true }),
      expect.anything(),
    )
  })

  it('follows defaults that arrive after it opened, until the user flips them', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    const paused = within(sheet).getByRole('switch', { name: 'Start paused' })
    const sequential = within(sheet).getByRole('switch', { name: 'Sequential download' })
    const firstLast = within(sheet).getByRole('switch', { name: 'First and last pieces first' })
    expect(paused).not.toBeChecked()
    expect(firstLast).not.toBeChecked()

    // The server's defaults load while the sheet is open.
    act(() => updateSettings({ startPaused: true, firstLastPieces: true }))
    expect(paused).toBeChecked()
    expect(firstLast).toBeChecked()

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

  it('cancels asking for the folders when the sheet goes away', async () => {
    vi.mocked(qbt.getSaveLocations).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderSheet()
    await waitFor(() => expect(vi.mocked(qbt.getSaveLocations).mock.lastCall?.[0]?.aborted).toBe(false))

    unmount()
    expect(vi.mocked(qbt.getSaveLocations).mock.lastCall?.[0]?.aborted).toBe(true)
  })

  it('shows the default save path for a category when qBittorrent doesn’t use category folders', async () => {
    vi.mocked(qbt.getSaveLocations).mockResolvedValue({
      categories: [{ name: 'TV', savePath: '/data/tv' }],
      defaultPath: '/data',
      categoryPaths: false,
      subcategories: false,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
    renderSheet()
    expect(await screen.findByText('TV → /data')).toBeInTheDocument()
  })

  it('works without categories, a default path or the free space from qBittorrent', async () => {
    // getSaveLocations turns qBittorrent's refusals into empty answers.
    vi.mocked(qbt.getSaveLocations).mockResolvedValue({ categories: [], defaultPath: '', categoryPaths: false, subcategories: false, relocateOnCategoryChange: true, downloadPath: false })
    getMainData.mockRejectedValue(new TypeError('Failed to fetch'))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent('Free:')
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/→/)).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Options' }))
    expect(within(sheet).queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText('Save path')).toHaveAttribute('placeholder', '')

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText(/free space|Free:/)).not.toBeInTheDocument()
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))

    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: undefined, savePath: undefined }),
      { meta: META, skip: [] },
    )
  })

  it('warns while the selected files need more than the free space, without blocking the download', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    expect(
      within(sheet).getByRole('status', {
        name: saying(/^40\.0\sGB free on qBittorrent’s disk, 10\.0\sGB short of this download\. Skip some files/),
      }),
    ).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled()

    await userEvent.click(within(sheet).getByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Season 1' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))
    // 40 GB selected fits exactly.
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it('takes the free space from the poll another screen runs, without asking qBittorrent for everything again', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    // rid 0 asks for every torrent, and it would make the poll's next answer a full one too.
    expect(getMainData.mock.calls.filter(([rid]) => rid === 0)).toHaveLength(1)
  })

  it('doesn’t wait for the free space: the warning comes with the poll’s first answer', async () => {
    let answer: (data: qbt.MainData) => void = () => {}
    getMainData.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent('Free:')
    expect(within(sheet).queryByRole('status', { name: saying('Not enough free space') })).not.toBeInTheDocument()

    answer({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    expect(files).toHaveTextContent(/Free: 40\.0\sGB/)
  })

  it('keeps the warning and the file picker current with the poll while it’s open', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await within(sheet).findByRole('status', { name: saying('Not enough free space') })
    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).getByText('Not enough free space')).toBeInTheDocument()

    getMainData.mockResolvedValue({ rid: 2, server_state: { free_space_on_disk: 80e9 } })
    act(() => store.refresh())
    expect(await within(picker).findByText(/Free: 80\.0\sGB/)).toBeInTheDocument()
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))
    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/Free: 80\.0\sGB/)
    expect(within(back).queryByRole('status', { name: saying('Not enough free space') })).not.toBeInTheDocument()
  })

  it('doesn’t render again, the file picker included, for a poll that leaves the free space as it was', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await within(sheet).findByRole('status', { name: saying('Not enough free space') })
    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    screen.getByRole('dialog', { name: 'Select files' })
    const settled = commits.mock.calls.length

    getMainData.mockResolvedValue({ rid: 2, server_state: { dl_info_speed: 1 } })
    act(() => store.refresh())
    await waitFor(() => expect(store.getSnapshot().data?.server.dl_info_speed).toBe(1))
    expect(commits).toHaveBeenCalledTimes(settled)
  })

  it('asks only to free up space for a one-file torrent, which has no files to skip', async () => {
    readTorrentFile.mockResolvedValue({ ...META, files: [{ path: 'Breaking Bad', size: 50e9 }] })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying(/10\.0\sGB short of this download\. Free up space before it finishes\.$/) })).toBeInTheDocument()
    expect(within(sheet).queryByText(/Skip some files/)).not.toBeInTheDocument()
  })

  it('doesn’t warn by the release size when the torrent can’t be fetched', async () => {
    fetchRelease.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t get the torrent from Prowlarr.') })).toBeInTheDocument()
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it('doesn’t warn by the release size when the .torrent can’t be read', async () => {
    readTorrentFile.mockRejectedValue(new Error('not bencoded'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it.each([0, -1])('treats %s free as unknown: no warning and no free space shown', async (free) => {
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: free } })
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent('Free:')
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(picker).queryByText(/Free:/)).not.toBeInTheDocument()
  })

  it('warns about a magnet link by the release size', async () => {
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(
      await within(sheet).findByRole('status', { name: saying(/40\.0\sGB short of this download\. Free up space before it finishes\./) }),
    ).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeEnabled()
  })

  it('says when qBittorrent refuses the torrent', async () => {
    addRelease.mockRejectedValue(new qbt.QbittorrentError('Fails.', 200))
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying(/may already be in your downloads/) })).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('says whether qBittorrent or Kinopeer itself didn’t answer the add', async () => {
    addRelease.mockRejectedValueOnce(qbittorrentDown()).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach Kinopeer. Try again.') })).toBeInTheDocument()
  })
})
