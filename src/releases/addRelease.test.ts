import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as qbt from '../api/qbittorrent'
import { addRelease, type AddReleaseOptions } from './addRelease'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof qbt>()
  return { ...actual, addTorrents: vi.fn(), getTorrentFiles: vi.fn(), setFilePriority: vi.fn(), startTorrents: vi.fn() }
})

const addTorrents = vi.mocked(qbt.addTorrents)
const getTorrentFiles = vi.mocked(qbt.getTorrentFiles)
const setFilePriority = vi.mocked(qbt.setFilePriority)
const startTorrents = vi.mocked(qbt.startTorrents)

const OPTIONS: AddReleaseOptions = { tags: ['tmdb:tv:1396'], category: 'TV', paused: false, sequential: false, topOfQueue: true }
const FILE = new File([new Uint8Array([1])], 'bb.torrent')
const META = {
  infoHash: 'abc123',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10 },
    { path: 'Season 2/e01.mkv', size: 20 },
    { path: 'Season 2/e02.mkv', size: 20 },
  ],
  totalSize: 50,
}
const QBT_FILES = META.files.map((file, index) => ({
  index,
  name: `Breaking Bad/${file.path}`,
  size: file.size,
  progress: 0,
  priority: 1 as const,
}))
const wait = () => Promise.resolve()

beforeEach(() => {
  vi.resetAllMocks()
})

describe('addRelease', () => {
  it('adds a magnet link with the options and nothing more', async () => {
    await addRelease({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' }, { ...OPTIONS, paused: true, sequential: true })
    expect(addTorrents).toHaveBeenCalledWith({
      urls: ['magnet:?xt=urn:btih:abc'],
      tags: ['tmdb:tv:1396'],
      category: 'TV',
      savePath: undefined,
      stopped: true,
      sequentialDownload: true,
      addToTopOfQueue: true,
    })
    expect(getTorrentFiles).not.toHaveBeenCalled()
  })

  it('adds a .torrent with every file selected as is', async () => {
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [] })
    expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ files: [FILE], stopped: false }))
    expect(setFilePriority).not.toHaveBeenCalled()
  })

  it('adds stopped, skips unselected files once qBittorrent lists them, then starts', async () => {
    getTorrentFiles
      .mockRejectedValueOnce(new qbt.QbittorrentError('not yet', 404))
      .mockResolvedValueOnce([])
      .mockResolvedValue(QBT_FILES)
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [0, 2] }, wait)

    expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ stopped: true }))
    expect(getTorrentFiles).toHaveBeenCalledTimes(3)
    expect(setFilePriority).toHaveBeenCalledWith('abc123', [0, 2], 0)
    expect(startTorrents).toHaveBeenCalledWith(['abc123'])
  })

  it('leaves a partial download paused when asked to', async () => {
    getTorrentFiles.mockResolvedValue(QBT_FILES.map((file) => ({ ...file, name: file.name.slice('Breaking Bad/'.length) })))
    await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, paused: true }, { meta: META, skip: [1] }, wait)
    expect(setFilePriority).toHaveBeenCalledWith('abc123', [1], 0)
    expect(startTorrents).not.toHaveBeenCalled()
  })

  it('gives up when qBittorrent never lists the files', async () => {
    getTorrentFiles.mockResolvedValue([])
    await expect(addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [1] }, wait)).rejects.toBeInstanceOf(
      qbt.QbittorrentError,
    )
    expect(startTorrents).not.toHaveBeenCalled()
  })
})
