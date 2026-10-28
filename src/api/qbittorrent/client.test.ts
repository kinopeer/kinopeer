import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  QbittorrentError,
  addTorrents,
  deleteTorrents,
  getCategories,
  getDefaultSavePath,
  getTorrentFiles,
  getTorrents,
  setFilePriority,
  setSpeedLimits,
  startTorrents,
  stopTorrents,
} from './client'

let fetchMock: Mock<typeof fetch>

function respond(body: string, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : body, { status }))
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), init: init! }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getTorrents', () => {
  it('encodes the query and joins hashes with a pipe', async () => {
    respond('[{"hash":"abc","name":"Dune"}]')
    const torrents = await getTorrents({ filter: 'downloading', sort: 'added_on', reverse: true, hashes: ['a', 'b'] })

    expect(torrents).toEqual([{ hash: 'abc', name: 'Dune' }])
    const url = new URL(lastCall().url, 'http://localhost')
    expect(url.pathname).toBe('/qbt/api/v2/torrents/info')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      filter: 'downloading',
      sort: 'added_on',
      reverse: 'true',
      hashes: 'a|b',
    })
  })
})

describe('addTorrents', () => {
  it('posts files, links and options as multipart form data', async () => {
    respond('Ok.')
    const file = new File([new Uint8Array([100, 101])], 'dune.torrent')
    await addTorrents({ files: [file], urls: ['magnet:?xt=urn:btih:abc', 'https://x/y.torrent'], tags: ['tmdb:movie:438631'], category: 'Movies', stopped: true })

    const { url, init } = lastCall()
    expect(url).toBe('/qbt/api/v2/torrents/add')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect((form.get('torrents') as File).name).toBe('dune.torrent')
    expect(form.get('urls')).toBe('magnet:?xt=urn:btih:abc\nhttps://x/y.torrent')
    expect(form.get('tags')).toBe('tmdb:movie:438631')
    expect(form.get('category')).toBe('Movies')
    expect(form.get('stopped')).toBe('true')
    expect(form.get('paused')).toBe('true')
    expect(form.has('savepath')).toBe(false)
    expect(form.has('stopCondition')).toBe(false)
    expect(form.has('sequentialDownload')).toBe(false)
    expect(form.has('firstLastPiecePrio')).toBe(false)
  })

  it('sends the queue and piece order options', async () => {
    respond('Ok.')
    await addTorrents({
      urls: ['magnet:?xt=urn:btih:abc'],
      savePath: '/data/tv',
      sequentialDownload: true,
      firstLastPiecePrio: true,
      addToTopOfQueue: true,
    })
    const form = lastCall().init.body as FormData
    expect(form.get('savepath')).toBe('/data/tv')
    expect(form.get('sequentialDownload')).toBe('true')
    expect(form.get('firstLastPiecePrio')).toBe('true')
    expect(form.get('addToTopOfQueue')).toBe('true')
  })

  it('reports a torrent qBittorrent refused', async () => {
    respond('Fails.')
    await expect(addTorrents({ urls: ['magnet:?xt=urn:btih:abc'] })).rejects.toBeInstanceOf(QbittorrentError)
  })
})

describe('save locations', () => {
  it('lists categories and the default save path', async () => {
    respond(JSON.stringify({ Movies: { name: 'Movies', savePath: '/data/movies' }, TV: { name: 'TV', savePath: '' } }))
    await expect(getCategories()).resolves.toEqual([
      { name: 'Movies', savePath: '/data/movies' },
      { name: 'TV', savePath: '' },
    ])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/categories')

    respond('/downloads\n')
    await expect(getDefaultSavePath()).resolves.toBe('/downloads')
  })
})

describe('torrent files', () => {
  it('lists files and sets priorities', async () => {
    respond(JSON.stringify([{ index: 0, name: 'a.mkv', size: 1, progress: 0, priority: 1 }]))
    await expect(getTorrentFiles('h1')).resolves.toHaveLength(1)
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/files?hash=h1')

    respond('')
    await setFilePriority('h1', [1, 3], 0)
    expect(String(lastCall().init.body)).toBe('hash=h1&id=1%7C3&priority=0')
  })

  it('skips an empty priority change', async () => {
    await setFilePriority('h1', [], 0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('setSpeedLimits', () => {
  it('sends both limits at once rather than one after the other', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    respond('')
    void setSpeedLimits(['a'], { download: 1_000_000, upload: 1_000_000 })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('sets the download and the upload limit in bytes/s', async () => {
    respond('')
    respond('')
    await setSpeedLimits(['a', 'b'], { download: 2_000_000, upload: 0 })
    const [download, upload] = fetchMock.mock.calls.map(([url, init]) => [String(url), String(init!.body)])
    expect(download).toEqual(['/qbt/api/v2/torrents/setDownloadLimit', 'hashes=a%7Cb&limit=2000000'])
    expect(upload).toEqual(['/qbt/api/v2/torrents/setUploadLimit', 'hashes=a%7Cb&limit=0'])
  })

  it('leaves a limit that is left out as it is', async () => {
    respond('')
    await setSpeedLimits(['a'], { upload: 1_000_000 })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/qbt/api/v2/torrents/setUploadLimit'])
  })
})

describe('startTorrents', () => {
  it('uses /torrents/start, falling back to /torrents/resume on qBittorrent 4', async () => {
    respond('')
    await startTorrents(['a', 'b'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/start')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb')

    respond('Not Found', 404)
    respond('')
    await startTorrents(['a'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/resume')
  })
})

describe('stopTorrents', () => {
  it('uses /torrents/stop, falling back to /torrents/pause on qBittorrent 4', async () => {
    respond('')
    await stopTorrents(['a'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/stop')
    expect(String(lastCall().init.body)).toBe('hashes=a')

    respond('Not Found', 404)
    respond('')
    await stopTorrents(['a'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/pause')
  })
})

describe('deleteTorrents', () => {
  it('posts the hashes and whether to delete files', async () => {
    respond('')
    await deleteTorrents(['a', 'b'], true)
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/delete')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb&deleteFiles=true')
  })
})
