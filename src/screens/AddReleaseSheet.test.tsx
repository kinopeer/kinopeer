import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import { SERVER_SETTINGS_KEY, type ServerSettings } from '../api/settings'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as adding from '../releases/addRelease'
import { sharedRequests } from '../logic/sharedRequests'
import { parseRelease } from '../releases/parseRelease'
import { resetSettings, updateSettings } from '../settings/settings'
import * as torrentFile from '../torrents/torrentFile'
import { MainDataContext, createMainDataStore, type MainDataStore } from '../torrents/useMainData'
import { AddReleaseSheet } from './AddReleaseSheet'
import { torrent } from '../test/fixtures'
import { ROUTER_OPTIONS } from '../lib/routerOptions'
import { Opened, opened, qbittorrentDown, saying } from '../test/render'

vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  fetchRelease: vi.fn(),
}))
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getSaveLocations: vi.fn(),
  getMainData: vi.fn(),
  getTorrents: vi.fn(),
}))
vi.mock('../releases/addRelease', () => ({ addRelease: vi.fn() }))
vi.mock('../torrents/torrentFile', async (importOriginal) => ({
  ...(await importOriginal<typeof torrentFile>()),
  readTorrentFile: vi.fn(),
}))

const fetchRelease = vi.mocked(prowlarr.fetchRelease)
const getMainData = vi.mocked(qbt.getMainData)
const getTorrents = vi.mocked(qbt.getTorrents)
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
  infoHash: 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10e9 },
    { path: 'Season 2/e01.mkv', size: 20e9 },
    { path: 'Season 2/e02.mkv', size: 20e9 },
  ],
  totalSize: 50e9,
}

/** The page's answer of the server's settings, with a channel to notify through or without. */
function serverHasChannel(notifications: boolean) {
  sharedRequests.set<ServerSettings>(SERVER_SETTINGS_KEY, {
    tmdb: { configured: true, source: 'env', fallback: 'env' },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: null,
    notifications,
  })
}

/** The app's shared poll, in use by a screen and answered once. */
async function runningPoll() {
  const store = createMainDataStore()
  onTestFinished(store.subscribe(() => {}))
  await waitFor(() => expect(store.getSnapshot().data).not.toBeNull())
  return store
}

const RELEASES_PAGE = '/title/tv/1396/releases'

function renderSheet(release = RELEASE, store?: MainDataStore) {
  const onAdded = vi.fn()
  const onClose = vi.fn()
  const sheet = (
    <AddReleaseSheet
      release={release}
      info={parseRelease(release.title)}
      title={{ type: 'tv', id: 1396, name: 'Breaking Bad', posterPath: null }}
      onClose={onClose}
      onAdded={onAdded}
    />
  )
  const { unmount } = render(
    <MemoryRouter initialEntries={[RELEASES_PAGE]} {...ROUTER_OPTIONS}>
      <Routes>
        <Route path={RELEASES_PAGE} element={sheet} />
        <Route path="/torrent/:hash" element={<Opened />} />
      </Routes>
    </MemoryRouter>,
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
  getTorrents.mockResolvedValue([])
})

describe('AddReleaseSheet', () => {
  it('picks files by season and adds the release to its category with the title tag', async () => {
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByText('Breaking Bad')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open on Indexer C' })).toHaveAttribute('href', 'https://tracker.test/bb')
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    // A .torrent's files can be picked, so the magnet link's note isn't there.
    expect(within(sheet).queryByText(/^Magnet link:/)).not.toBeInTheDocument()

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
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'No category' }))
    // A path isn't a word, so the browser doesn't underline it.
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('spellcheck', 'false')
    // Nor does iOS Safari correct it (#494).
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('autocorrect', 'off')
    await userEvent.type(within(sheet).getByLabelText('Folder'), '/mnt/tv')
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

  it('offers Notify when finished while the server has a channel, and tags the torrent for it', async () => {
    serverHasChannel(true)
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    const notify = within(sheet).getByRole('switch', { name: 'Notify when finished' })
    expect(notify).not.toBeChecked()
    await userEvent.click(notify)
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396', 'kinopeer:notify'] }), expect.anything())
  })

  it('starts Notify when finished from the default in Settings', async () => {
    serverHasChannel(true)
    updateSettings({ notify: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396', 'kinopeer:notify'] }), expect.anything())
  })

  it('neither offers Notify when finished nor applies its default without a channel to notify through', async () => {
    serverHasChannel(false)
    updateSettings({ notify: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    expect(within(sheet).getByRole('switch', { name: 'Add to top of queue' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('switch', { name: 'Notify when finished' })).not.toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396'] }), expect.anything())
  })

  it('marks the category the torrent goes to', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
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
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
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
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/→/)).not.toBeInTheDocument()

    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    expect(within(sheet).queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('placeholder', '')

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText(/free/)).not.toBeInTheDocument()
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
    // Once qBittorrent has said it doesn't have the torrent, which may come after the free space.
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())

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
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByRole('status', { name: saying('Not enough free space') })).not.toBeInTheDocument()

    answer({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    expect(files).toHaveTextContent(/40\.0\sGB free/)
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
    expect(await within(picker).findByText(/80\.0\sGB free/)).toBeInTheDocument()
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))
    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/80\.0\sGB free/)
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
    // Nor a list of files to pick from.
    expect(within(sheet).queryByRole('button', { name: /^Files/ })).not.toBeInTheDocument()
  })

  it('doesn’t send a torrent with every file skipped', async () => {
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Deselect all' }))
    // Done waits for a file, but Back leaves with none.
    await userEvent.click(within(picker).getByRole('button', { name: 'Back' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByRole('button', { name: /^Download/ })).toBeDisabled()
  })

  it.each([
    ['nothing answered for it', () => new TypeError('Failed to fetch')],
    ['something in front of it answered', () => new qbt.KinopeerUnreachableError(502)],
  ])('says it’s Kinopeer that didn’t answer for the torrent when %s, not Prowlarr (#566)', async (_name, error) => {
    fetchRelease.mockRejectedValue(error())
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach Kinopeer. Try again.') })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says qBittorrent didn’t answer, not Prowlarr, when it didn’t give Prowlarr’s address and key in the WebUI build', async () => {
    vi.stubGlobal('__WEBUI__', true)
    fetchRelease.mockRejectedValue(new prowlarr.ProwlarrKeyReadError(new TypeError('Failed to fetch')))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says it’s Prowlarr whose torrent failed in the WebUI build when qBittorrent gave its address and key', async () => {
    vi.stubGlobal('__WEBUI__', true)
    fetchRelease.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t get the torrent from Prowlarr.') })).toBeInTheDocument()
  })

  it('offers no form, the free space warning included, when the torrent can’t be fetched', async () => {
    fetchRelease.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t get the torrent from Prowlarr.') })).toBeInTheDocument()
    // The folders and the poll's free space in, which the form would show.
    await waitFor(() => expect(vi.mocked(qbt.getSaveLocations)).toHaveBeenCalled())
    await act(async () => {})
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('TV → /data/tv')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
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
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(picker).queryByText(/free/)).not.toBeInTheDocument()
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

  it('adds the link qBittorrent follows itself in the WebUI build, warned by the release size, with all its files', async () => {
    vi.stubGlobal('__WEBUI__', true)
    const link = 'http://192.168.1.20:9696/api/v1/indexer/1/download?link=abc&apikey=k'
    fetchRelease.mockResolvedValue({ kind: 'link', uri: link })
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Prowlarr gave a link qBittorrent fetches itself, so all files are downloaded/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/Magnet link: all files/)).not.toBeInTheDocument()
    expect(
      await within(sheet).findByRole('status', { name: saying(/40\.0\sGB short of this download\. Free up space before it finishes\./) }),
    ).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(addRelease).toHaveBeenCalledWith({ kind: 'link', uri: link }, expect.anything(), undefined)
  })

  it('says a magnet link’s files in the WebUI build as in the server build', async () => {
    vi.stubGlobal('__WEBUI__', true)
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/Prowlarr gave a link/)).not.toBeInTheDocument()
  })

  it('neither notes the files of a .torrent it can’t read nor warns by the release size in the WebUI build', async () => {
    vi.stubGlobal('__WEBUI__', true)
    readTorrentFile.mockRejectedValue(new Error('not bencoded'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/Magnet link: all files|Prowlarr gave a link/)).not.toBeInTheDocument()
  })

  it('says qBittorrent refused the torrent when it then doesn’t have it', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [META.infoHash] }, undefined)
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('says the torrent is already in downloads when qBittorrent refused it and has it', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(409))
    // Added meanwhile, from another device: qBittorrent has it by the time it refuses it.
    getTorrents.mockResolvedValueOnce([]).mockResolvedValueOnce([torrent(META.infoHash)])
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open details' })).toHaveAttribute('href', `/torrent/${META.infoHash}`)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('says it may already be in downloads when qBittorrent refused it and can’t be asked then', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    getTorrents.mockResolvedValueOnce([]).mockRejectedValueOnce(qbittorrentDown())
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
  })

  it('says qBittorrent refused a v1 magnet link when it then doesn’t have it', async () => {
    const hash = 'c9e15763f722f23e98a29decdfae341b98d53056'
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash}` })
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [hash] }, undefined)
  })

  it('says it may already be in downloads when qBittorrent refused a magnet link with only a v2 hash and doesn’t have it by that', async () => {
    // A hybrid torrent's ID is its v1 hash, which this link doesn't give.
    const v2 = 'ab'.repeat(32)
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btmh:1220${v2}` })
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [v2.slice(0, 40)] }, undefined)
  })

  it('says it may already be in downloads when qBittorrent refused a torrent whose hash isn’t known', async () => {
    readTorrentFile.mockRejectedValue(new torrentFile.InvalidTorrentError())
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
    expect(getTorrents).not.toHaveBeenCalled()
  })

  it('says whether qBittorrent or Kinopeer itself didn’t answer the add', async () => {
    addRelease.mockRejectedValueOnce(qbittorrentDown()).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach Kinopeer. Try again.') })).toBeInTheDocument()
  })

  describe('a torrent qBittorrent already has', () => {
    it('offers to open it in place of Download, over the page the sheet is on', async () => {
      getTorrents.mockResolvedValue([torrent(META.infoHash)])
      const { onClose } = renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      expect(await within(sheet).findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [META.infoHash] }, expect.any(AbortSignal))
      // Nothing to choose for a torrent that won't be added.
      expect(within(sheet).queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: /Files:/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
      expect(within(sheet).queryByText('TV → /data/tv')).not.toBeInTheDocument()

      await userEvent.click(within(sheet).getByRole('link', { name: 'Open details' }))
      expect(onClose).toHaveBeenCalled()
      expect(opened()).toBe(`/torrent/${META.infoHash} over ${RELEASES_PAGE}`)
    })

    it('finds a magnet link’s torrent by the link’s hash', async () => {
      const hash = 'd'.repeat(40)
      fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash.toUpperCase()}` })
      getTorrents.mockResolvedValue([torrent(hash)])
      renderSheet()
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [hash] }, expect.any(AbortSignal))
      expect(screen.queryByText(/Magnet link: all files/)).not.toBeInTheDocument()
    })

    it('keeps the free space warning away too', async () => {
      getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
      getTorrents.mockResolvedValue([torrent(META.infoHash)])
      renderSheet()
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      await waitFor(() => expect(getMainData).toHaveBeenCalled())
      expect(screen.queryByText('Not enough free space')).not.toBeInTheDocument()
    })
  })

  describe('a torrent qBittorrent doesn’t have', () => {
    it('waits for qBittorrent to say so before Download', async () => {
      let answer: (torrents: qbt.Torrent[]) => void = () => {}
      getTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      await waitFor(() => expect(getTorrents).toHaveBeenCalled())
      expect(within(sheet).getByRole('status', { name: saying('Checking your downloads…') })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
      // Nothing to open meanwhile that would go away if qBittorrent has it.
      expect(within(sheet).queryByRole('button', { name: /^Files/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()

      // Another torrent of the hashes asked for isn't this one.
      await act(async () => answer([torrent('e'.repeat(40))]))
      expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeEnabled()
      expect(within(sheet).queryByRole('status', { name: saying('Checking your downloads…') })).not.toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: /^Files: all \(3\)/ })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Options' })).toBeInTheDocument()
      expect(within(sheet).queryByRole('status', { name: saying('Already in downloads') })).not.toBeInTheDocument()
    })

    it('doesn’t offer the options while it gets the torrent either', async () => {
      let fetched: (source: { kind: 'magnet'; uri: string }) => void = () => {}
      fetchRelease.mockReturnValue(new Promise((resolve) => (fetched = resolve)))
      renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      expect(await within(sheet).findByRole('status', { name: saying('Getting the torrent…') })).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()

      await act(async () => fetched({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${'e'.repeat(40)}` }))
      expect(await within(sheet).findByRole('button', { name: 'Options' })).toBeInTheDocument()
    })

    it('offers Download when qBittorrent can’t be asked', async () => {
      getTorrents.mockRejectedValue(qbittorrentDown())
      renderSheet()
      await waitFor(() => expect(getTorrents).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByRole('button', { name: /^Download/ })).toBeEnabled())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('doesn’t ask qBittorrent when the hash isn’t known', async () => {
      readTorrentFile.mockRejectedValue(new torrentFile.InvalidTorrentError())
      renderSheet()
      await waitFor(() => expect(screen.getByRole('button', { name: /^Download/ })).toBeEnabled())
      expect(getTorrents).not.toHaveBeenCalled()
    })

    it('stops asking when the sheet goes away', async () => {
      getTorrents.mockReturnValue(new Promise(() => {}))
      const { unmount } = renderSheet()
      await waitFor(() => expect(getTorrents.mock.lastCall?.[1]?.aborted).toBe(false))
      unmount()
      expect(getTorrents.mock.lastCall?.[1]?.aborted).toBe(true)
    })
  })
})
