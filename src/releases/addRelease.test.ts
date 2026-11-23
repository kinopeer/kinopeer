import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as qbt from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { MediaNamesError, addRelease, type AddReleaseOptions } from './addRelease'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof qbt>()
  return { ...actual, addTorrents: vi.fn(), getTorrentFiles: vi.fn(), getTorrents: vi.fn(), setFilePriority: vi.fn(), startTorrents: vi.fn(), renameFiles: vi.fn() }
})

const addTorrents = vi.mocked(qbt.addTorrents)
const getTorrentFiles = vi.mocked(qbt.getTorrentFiles)
const setFilePriority = vi.mocked(qbt.setFilePriority)
const startTorrents = vi.mocked(qbt.startTorrents)
const renameFiles = vi.mocked(qbt.renameFiles)
const getTorrents = vi.mocked(qbt.getTorrents)

const OPTIONS: AddReleaseOptions = { tags: ['tmdb:tv:1396'], category: 'TV', paused: false, sequential: false, firstLastPieces: false, topOfQueue: true }
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
  multiFile: true,
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
    await addRelease({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' }, { ...OPTIONS, paused: true, sequential: true, firstLastPieces: true })
    expect(addTorrents).toHaveBeenCalledWith({
      urls: ['magnet:?xt=urn:btih:abc'],
      tags: ['tmdb:tv:1396'],
      category: 'TV',
      savePath: undefined,
      stopped: true,
      sequentialDownload: true,
      firstLastPiecePrio: true,
      addToTopOfQueue: true,
    })
    expect(getTorrentFiles).not.toHaveBeenCalled()
  })

  it('gives qBittorrent a download link to follow itself as it gives a magnet link', async () => {
    const link = 'http://192.168.1.20:9696/api/v1/indexer/1/download?link=abc&apikey=k'
    await addRelease({ kind: 'link', uri: link }, OPTIONS)
    expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ urls: [link] }))
    expect(addTorrents.mock.calls[0][0]).not.toHaveProperty('files')
  })

  it('adds a .torrent with every file selected as is', async () => {
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [] })
    expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ files: [FILE], stopped: false }))
    expect(setFilePriority).not.toHaveBeenCalled()
    // Added running: nothing to start after it, nor files to ask for.
    expect(startTorrents).not.toHaveBeenCalled()
    expect(getTorrentFiles).not.toHaveBeenCalled()
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

  it('finds a skipped file by its name wherever qBittorrent lists it', async () => {
    getTorrentFiles.mockResolvedValue([...QBT_FILES].reverse().map((file, index) => ({ ...file, index })))
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [0] }, wait)
    expect(setFilePriority).toHaveBeenCalledWith('abc123', [2], 0)
  })

  it('takes a skipped file by its place when qBittorrent names none like it but lists as many', async () => {
    getTorrentFiles.mockResolvedValue(QBT_FILES.map((file) => ({ ...file, name: `Other/${file.index}.mkv` })))
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [1] }, wait)
    expect(setFilePriority).toHaveBeenCalledWith('abc123', [1], 0)
  })

  it('skips nothing it can’t find when qBittorrent lists another number of files', async () => {
    getTorrentFiles.mockResolvedValue([{ ...QBT_FILES[0], name: 'Other/0.mkv' }, { ...QBT_FILES[1], name: 'Other/1.mkv' }])
    await addRelease({ kind: 'torrent', file: FILE }, OPTIONS, { meta: META, skip: [1] }, wait)
    expect(setFilePriority).toHaveBeenCalledWith('abc123', [], 0)
  })

  describe('naming a movie for a media server', () => {
    const MOVIE = {
      infoHash: 'def456',
      name: 'Arrival.2016.1080p',
      files: [
        { path: 'Arrival.2016.1080p.mkv', size: 8000 },
        { path: 'Arrival.2016.1080p.en.srt', size: 10 },
      ],
      totalSize: 8010,
      multiFile: true,
    }
    const MOVIE_FILES = MOVIE.files.map((file, index) => ({ index, name: `Arrival.2016.1080p/${file.path}`, size: file.size, progress: 0, priority: 1 as const }))
    const NAMES = { title: 'Arrival', year: 2016 }
    const ADDED = torrent('def456', { save_path: '/media/movies', content_path: '/media/movies/Arrival.2016.1080p' })

    beforeEach(() => {
      getTorrents.mockResolvedValue([ADDED])
    })

    it('adds stopped, renames the files once qBittorrent lists them, then starts', async () => {
      getTorrentFiles.mockResolvedValue(MOVIE_FILES)
      await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait)

      expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ stopped: true }))
      expect(setFilePriority).not.toHaveBeenCalled()
      expect(renameFiles).toHaveBeenCalledWith('def456', [
        { from: 'Arrival.2016.1080p/Arrival.2016.1080p.mkv', to: 'Arrival (2016)/Arrival (2016).mkv' },
        { from: 'Arrival.2016.1080p/Arrival.2016.1080p.en.srt', to: 'Arrival (2016)/Arrival (2016).en.srt' },
      ])
      expect(renameFiles.mock.invocationCallOrder[0]).toBeLessThan(startTorrents.mock.invocationCallOrder[0])
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('skips files and names the rest in one go, leaving it paused when asked to', async () => {
      getTorrentFiles.mockResolvedValue(MOVIE_FILES)
      await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, paused: true, mediaNames: NAMES }, { meta: MOVIE, skip: [1] }, wait)
      expect(getTorrentFiles).toHaveBeenCalledTimes(1)
      expect(setFilePriority).toHaveBeenCalledWith('def456', [1], 0)
      expect(renameFiles).toHaveBeenCalledWith('def456', expect.arrayContaining([expect.objectContaining({ to: 'Arrival (2016)/Arrival (2016).mkv' })]))
      expect(startTorrents).not.toHaveBeenCalled()
    })

    it('starts the torrent all the same when qBittorrent doesn’t list its files, and says they weren’t named', async () => {
      getTorrentFiles.mockResolvedValue([])
      const adding = addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait)
      await expect(adding).rejects.toBeInstanceOf(MediaNamesError)
      expect(renameFiles).not.toHaveBeenCalled()
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('adds a torrent whose files aren’t named as it is', async () => {
      getTorrentFiles.mockResolvedValue([{ index: 0, name: 'Arrival/cover.jpg', size: 10, progress: 0, priority: 1 }])
      await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait)
      expect(renameFiles).not.toHaveBeenCalled()
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('starts the torrent all the same when the renames fail, and says they did', async () => {
      getTorrentFiles.mockResolvedValue(MOVIE_FILES)
      const refused = new qbt.QbittorrentError('The file already exists', 409)
      renameFiles.mockRejectedValue(refused)
      const error = await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(MediaNamesError)
      expect((error as MediaNamesError).cause).toBe(refused)
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('doesn’t name the files when another torrent is in the folder naming would use, starts it and says which', async () => {
      getTorrentFiles.mockResolvedValue(MOVIE_FILES)
      const other = torrent('older', { name: 'Arrival.2016.2160p', save_path: '/media/movies/', content_path: '/media/movies/Arrival (2016)' })
      getTorrents.mockResolvedValue([other, ADDED])
      const error = await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(MediaNamesError)
      expect((error as MediaNamesError).taken).toEqual({ name: 'Arrival.2016.2160p', folder: 'Arrival (2016)' })
      expect(renameFiles).not.toHaveBeenCalled()
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('names nothing, and says so, when qBittorrent doesn’t list the torrent it added', async () => {
      getTorrentFiles.mockResolvedValue(MOVIE_FILES)
      getTorrents.mockResolvedValue([])
      const error = await addRelease({ kind: 'torrent', file: FILE }, { ...OPTIONS, mediaNames: NAMES }, { meta: MOVIE, skip: [] }, wait).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(MediaNamesError)
      expect((error as MediaNamesError).taken).toBeUndefined()
      expect(renameFiles).not.toHaveBeenCalled()
      expect(startTorrents).toHaveBeenCalledWith(['def456'])
    })

    it('names nothing without the torrent’s files, as for a magnet link', async () => {
      await addRelease({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' }, { ...OPTIONS, mediaNames: NAMES })
      expect(addTorrents).toHaveBeenCalledWith(expect.objectContaining({ stopped: false }))
      expect(getTorrentFiles).not.toHaveBeenCalled()
    })
  })
})
