import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  InvalidCredentialsError,
  IpBannedError,
  QbittorrentError,
  UnauthorizedError,
  addTorrents,
  getAppVersion,
  getCategories,
  getDefaultSavePath,
  getMainData,
  getTorrentFiles,
  getTorrents,
  login,
  logout,
  setFilePriority,
  startTorrents,
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

describe('login', () => {
  it('posts form-encoded credentials', async () => {
    respond('Ok.')
    await login('admin', 'p@ss&word')

    const { url, init } = lastCall()
    expect(url).toBe('/qbt/api/v2/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(String(init.body)).toBe('username=admin&password=p%40ss%26word')
  })

  it('accepts an empty 204 as success', async () => {
    respond('', 204)
    await expect(login('admin', 'secret')).resolves.toBeUndefined()
  })

  it('rejects wrong credentials', async () => {
    respond('Fails.')
    await expect(login('admin', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('rejects wrong credentials answered with 401 (qBittorrent 5.3+)', async () => {
    respond('Unauthorized', 401)
    await expect(login('admin', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('reports an IP ban', async () => {
    respond('Your IP address has been banned', 403)
    await expect(login('admin', 'wrong')).rejects.toBeInstanceOf(IpBannedError)
  })
})

describe('authenticated requests', () => {
  it('returns the app version', async () => {
    respond('v5.0.4\n')
    await expect(getAppVersion()).resolves.toBe('v5.0.4')
    expect(lastCall().url).toBe('/qbt/api/v2/app/version')
  })

  it('throws UnauthorizedError without a session', async () => {
    respond('Forbidden', 403)
    await expect(getAppVersion()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws QbittorrentError with the status on other failures', async () => {
    respond('Bad Gateway', 502)
    const error = await getAppVersion().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(QbittorrentError)
    expect((error as QbittorrentError).status).toBe(502)
  })

  it('logs out with a POST', async () => {
    respond('')
    await logout()
    expect(lastCall().url).toBe('/qbt/api/v2/auth/logout')
    expect(lastCall().init.method).toBe('POST')
  })
})

describe('getTorrents', () => {
  it('requests all torrents without a query string by default', async () => {
    respond('[]')
    await expect(getTorrents()).resolves.toEqual([])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/info')
  })

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

describe('getMainData', () => {
  it('passes the response id and returns the parsed delta', async () => {
    respond(JSON.stringify({ rid: 8, torrents: { abc: { progress: 0.5 } } }))
    await expect(getMainData(7)).resolves.toEqual({ rid: 8, torrents: { abc: { progress: 0.5 } } })
    expect(lastCall().url).toBe('/qbt/api/v2/sync/maindata?rid=7')
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
  })

  it('sends the queue and sequential download options', async () => {
    respond('Ok.')
    await addTorrents({ urls: ['magnet:?xt=urn:btih:abc'], savePath: '/data/tv', sequentialDownload: true, addToTopOfQueue: true })
    const form = lastCall().init.body as FormData
    expect(form.get('savepath')).toBe('/data/tv')
    expect(form.get('sequentialDownload')).toBe('true')
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
