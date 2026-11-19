import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProxySignInError } from '../fetchKinopeer'
import { sharedRequests } from '../../logic/sharedRequests'
import {
  APP_VERSION_FRESH_MS,
  APP_VERSION_KEY,
  BRIDGE_HEADER,
  KinopeerUnreachableError,
  NoAddressError,
  QbittorrentError,
  UnauthorizedError,
  addTorrents,
  TorrentRefusedError,
  deleteTorrents,
  getAppVersion,
  getCategories,
  getDefaultSavePath,
  getMainData,
  getRefreshInterval,
  getSaveLocations,
  getTorrentFiles,
  getTorrentTrackers,
  getTorrents,
  reannounceTorrents,
  recheckTorrents,
  setCategory,
  setFilePriority,
  setSpeedLimits,
  setTorrentLocation,
  startTorrents,
  stopTorrents,
  toggleFirstLastPiecePrio,
  toggleSequentialDownload,
  toggleSpeedLimitsMode,
  unreachable,
} from './client'

let fetchMock: Mock<typeof fetch>

/** An answer of the bridge, with its mark. */
function respond(body: string, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : body, { status, headers: { [BRIDGE_HEADER]: '1' } }))
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), init: init! }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('getTorrents', () => {
  it('encodes the query and joins hashes with a pipe', async () => {
    respond('[{"hash":"abc","name":"Dune"}]')
    const torrents = await getTorrents({ filter: 'downloading', sort: 'added_on', reverse: true, hashes: ['a', 'b'] })

    expect(torrents).toEqual([{ hash: 'abc', name: 'Dune' }])
    const url = new URL(lastCall().url, 'http://localhost')
    expect(url.pathname).toBe('/qbt/api/v2/torrents/info')
    expect(lastCall().init).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
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

  it('reports a torrent qBittorrent refused, as 5.1 and earlier answer', async () => {
    respond('Fails.')
    await expect(addTorrents({ urls: ['magnet:?xt=urn:btih:abc'] })).rejects.toBeInstanceOf(TorrentRefusedError)
  })

  it('reports a torrent qBittorrent refused, as 5.2 and later answer', async () => {
    respond('', 409)
    await expect(addTorrents({ urls: ['magnet:?xt=urn:btih:abc'] })).rejects.toBeInstanceOf(TorrentRefusedError)
  })

  it('passes on any other failure of an add as it is', async () => {
    respond('', 500)
    const failed = await addTorrents({ urls: ['magnet:?xt=urn:btih:abc'] }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(QbittorrentError)
    expect(failed).not.toBeInstanceOf(TorrentRefusedError)
    // A 409 from something in front of Kinopeer's server, without the bridge's mark, is no refusal.
    fetchMock.mockResolvedValueOnce(new Response('', { status: 409 }))
    await expect(addTorrents({ urls: ['magnet:?xt=urn:btih:abc'] })).rejects.toBeInstanceOf(KinopeerUnreachableError)
  })
})

describe('what a screen can cancel', () => {
  const { signal } = new AbortController()

  it.each([
    { name: 'getAppVersion', read: () => getAppVersion(signal), requests: 1 },
    { name: 'getCategories', read: () => getCategories(signal), requests: 1 },
    { name: 'getDefaultSavePath', read: () => getDefaultSavePath(signal), requests: 1 },
    { name: 'getMainData', read: () => getMainData(0, signal), requests: 1 },
    { name: 'getSaveLocations', read: () => getSaveLocations(signal), requests: 3 },
    { name: 'getTorrents', read: () => getTorrents({ hashes: ['abc'] }, signal), requests: 1 },
    { name: 'getTorrentTrackers', read: () => getTorrentTrackers('abc', signal), requests: 1 },
  ])('$name hands the signal to every request', async ({ read, requests }) => {
    // The version getSaveLocations reads is the page's shared answer, which sharedRequests cancels.
    sharedRequests.set(APP_VERSION_KEY, '5.0.4')
    fetchMock.mockImplementation(async () => new Response('{}'))
    await read()

    expect(fetchMock).toHaveBeenCalledTimes(requests)
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal).toBe(signal)
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
    // Two calls while the first never answers: the upload request didn't wait for it.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('fails only once both requests are over, so the caller never refreshes with one still in flight', async () => {
    respond('Bad', 500)
    let answerUpload!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answerUpload = resolve)))
    let settled = false
    const saving = setSpeedLimits(['a'], { download: 1_000_000, upload: 1_000_000 }).finally(() => (settled = true))
    saving.catch(() => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // A macrotask tick runs every pending microtask, so a rejection that didn't wait for the upload
    // request would have settled the promise by now.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    answerUpload(new Response(''))
    await expect(saving).rejects.toThrow('qBittorrent responded 500')
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

describe('recheckTorrents and reannounceTorrents', () => {
  it('post the hashes joined with a pipe', async () => {
    respond('')
    await recheckTorrents(['a', 'b'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/recheck')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb')

    respond('')
    await reannounceTorrents(['a'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/reannounce')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a')
  })
})

describe('toggleSequentialDownload and toggleFirstLastPiecePrio', () => {
  it('post the hashes joined with a pipe', async () => {
    respond('')
    await toggleSequentialDownload(['a', 'b'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/toggleSequentialDownload')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb')

    respond('')
    await toggleFirstLastPiecePrio(['a'])
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/toggleFirstLastPiecePrio')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a')
  })
})

describe('setCategory', () => {
  it('posts the hashes and the category, empty for none', async () => {
    respond('')
    await setCategory(['a', 'b'], 'TV Shows')
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/setCategory')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb&category=TV+Shows')

    respond('')
    await setCategory(['a'], '')
    expect(String(lastCall().init.body)).toBe('hashes=a&category=')
  })

  it('reports a category qBittorrent doesn’t have', async () => {
    respond('Incorrect category name', 409)
    await expect(setCategory(['a'], 'Gone')).rejects.toMatchObject({ status: 409 })
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

describe('getAppVersion', () => {
  it("reads qBittorrent's version without its \"v\", as Kinopeer and Prowlarr write theirs", async () => {
    respond('v5.0.4\n')
    await expect(getAppVersion()).resolves.toBe('5.0.4')
    expect(lastCall().url).toBe('/qbt/api/v2/app/version')
  })

  it('says the server has no address for qBittorrent when the bridge marks its answer so', async () => {
    fetchMock.mockResolvedValueOnce(new Response('qBittorrent has no address', { status: 503, headers: { [BRIDGE_HEADER]: 'no-address' } }))
    const error = await getAppVersion().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NoAddressError)
    expect(unreachable(error)).toBe('qbittorrent')
    // Any other failure of the bridge is qBittorrent's.
    respond('', 503)
    await expect(getAppVersion()).rejects.not.toBeInstanceOf(NoAddressError)
  })
})

describe('setTorrentLocation', () => {
  it('posts the hashes and the new folder', async () => {
    respond('')
    await setTorrentLocation(['a', 'b'], '/downloads/Movies')
    expect(lastCall().url).toBe('/qbt/api/v2/torrents/setLocation')
    expect(lastCall().init.method).toBe('POST')
    expect(String(lastCall().init.body)).toBe('hashes=a%7Cb&location=%2Fdownloads%2FMovies')
  })

  it('reports a folder qBittorrent cannot write to as an error, not a lost session', async () => {
    respond('', 403)
    respond('v5.0.4')
    const error = await setTorrentLocation(['a'], '/root').catch((caught: unknown) => caught)
    expect(lastCall().url).toBe('/qbt/api/v2/app/version')
    expect(error).toBeInstanceOf(QbittorrentError)
    expect(error).not.toBeInstanceOf(UnauthorizedError)
    expect(error).toMatchObject({ status: 403 })
  })

  it('reports a lost session when qBittorrent refuses everything', async () => {
    respond('', 403)
    respond('', 403)
    await expect(setTorrentLocation(['a'], '/root')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('getRefreshInterval', () => {
  it('reads how often qBittorrent updates the torrents’ states from its preferences', async () => {
    respond('{"refresh_interval":5000,"save_path":"/downloads"}')
    expect(await getRefreshInterval()).toBe(5000)
    expect(fetchMock).toHaveBeenCalledWith('/qbt/api/v2/app/preferences', expect.anything())
  })

  it.each(['{}', '{"refresh_interval":0}', '{"refresh_interval":"1500"}'])('says nothing for %s', async (preferences) => {
    respond(preferences)
    expect(await getRefreshInterval()).toBeUndefined()
  })
})

describe('getSaveLocations', () => {
  const answer =
    (preferences: string, version = 'v5.0.4') =>
    async (url: string | URL | Request) => {
      const path = String(url)
      if (path.endsWith('/torrents/categories'))
        return new Response('{"TV":{"name":"TV","savePath":""},"Movies":{"name":"Movies","savePath":"/m"}}')
      if (path.endsWith('/app/preferences')) return new Response(preferences)
      if (path.endsWith('/app/version')) return new Response(version, { status: version ? 200 : 500 })
      return new Response('/downloads\n')
    }

  it('gets the categories by name, the default save path and how qBittorrent uses category folders', async () => {
    fetchMock.mockImplementation(answer('{"auto_tmm_enabled":false,"use_category_paths_in_manual_mode":true,"use_subcategories":true}'))
    expect(await getSaveLocations()).toEqual({
      categories: [
        { name: 'Movies', savePath: '/m' },
        { name: 'TV', savePath: '' },
      ],
      defaultPath: '/downloads',
      categoryPaths: true,
      subcategories: true,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
  })

  it('reads whether changing the category moves the files or switches the torrent to manual mode', async () => {
    fetchMock.mockImplementation(answer('{"torrent_changed_tmm_enabled":false}'))
    expect(await getSaveLocations()).toMatchObject({ relocateOnCategoryChange: false })
    fetchMock.mockImplementation(answer('{"torrent_changed_tmm_enabled":true}'))
    expect(await getSaveLocations()).toMatchObject({ relocateOnCategoryChange: true })
  })

  it('uses category folders for new torrents only with automatic management or category paths in manual mode', async () => {
    fetchMock.mockImplementation(
      answer('{"auto_tmm_enabled":true,"use_category_paths_in_manual_mode":false,"use_subcategories":false}'),
    )
    expect(await getSaveLocations()).toMatchObject({ categoryPaths: true, subcategories: false })
    // qBittorrent before 4.4 has no category paths in manual mode.
    fetchMock.mockImplementation(answer('{"auto_tmm_enabled":false}'))
    expect(await getSaveLocations()).toMatchObject({ categoryPaths: false })
  })

  it('puts subcategories under their parent’s folder as the version of qBittorrent does', async () => {
    fetchMock.mockImplementation(answer('{"use_subcategories":true}', 'v4.6.7'))
    expect(await getSaveLocations()).toMatchObject({ subcategories: false })
    sharedRequests.clear()
    // qBittorrent 5.2 always has subcategories on and no longer reports the setting.
    fetchMock.mockImplementation(answer('{}', 'v5.2.0'))
    expect(await getSaveLocations()).toMatchObject({ subcategories: true })
  })

  it('takes the version the page already has rather than asking qBittorrent again', async () => {
    sharedRequests.set(APP_VERSION_KEY, '4.6.7')
    fetchMock.mockImplementation(answer('{"use_subcategories":true}', 'v5.0.4'))
    expect(await getSaveLocations()).toMatchObject({ subcategories: false })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/qbt/api/v2/app/version')
  })

  it('cancels its own request of the version when the caller gives up', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(answer('{}'))
    const reading = getSaveLocations(controller.signal)
    controller.abort()
    await reading.catch(() => undefined)
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url) === '/qbt/api/v2/app/version')!
    expect(init?.signal?.aborted).toBe(true)
  })

  it('takes the page’s version however old it is, since only an update changes it', async () => {
    vi.useFakeTimers()
    try {
      sharedRequests.set(APP_VERSION_KEY, '4.6.7')
      vi.advanceTimersByTime(APP_VERSION_FRESH_MS * 60)
      fetchMock.mockImplementation(answer('{"use_subcategories":true}', 'v5.0.4'))
      expect(await getSaveLocations()).toMatchObject({ subcategories: false })
      expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/qbt/api/v2/app/version')
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes by the setting when the version doesn’t answer, and has no subcategories when the preferences don’t', async () => {
    fetchMock.mockImplementation(answer('{"use_subcategories":true}', ''))
    expect(await getSaveLocations()).toMatchObject({ subcategories: true })
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/app/preferences') ? new Response('', { status: 500, headers: { [BRIDGE_HEADER]: '1' } }) : new Response('v5.2.0'),
    )
    expect(await getSaveLocations()).toMatchObject({ subcategories: false })
  })

  it('reads whether qBittorrent keeps incomplete torrents in a folder of their own', async () => {
    fetchMock.mockImplementation(answer('{"temp_path_enabled":true}'))
    expect(await getSaveLocations()).toMatchObject({ downloadPath: true })
    fetchMock.mockImplementation(answer('{}'))
    expect(await getSaveLocations()).toMatchObject({ downloadPath: false })
  })

  it('takes qBittorrent’s defaults when its preferences can’t be read', async () => {
    fetchMock.mockImplementation(answer('<!doctype html>'))
    // qBittorrent relocates a torrent whose category changed unless told otherwise.
    expect(await getSaveLocations()).toMatchObject({
      defaultPath: '/downloads',
      categoryPaths: false,
      subcategories: false,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
  })

  it('does without what qBittorrent doesn’t answer, with its defaults', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    expect(await getSaveLocations()).toEqual({
      categories: [],
      defaultPath: '',
      categoryPaths: false,
      subcategories: false,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
  })
})

describe('toggleSpeedLimitsMode', () => {
  it('posts to /transfer/toggleSpeedLimitsMode', async () => {
    respond('')
    await toggleSpeedLimitsMode()
    expect(lastCall().url).toBe('/qbt/api/v2/transfer/toggleSpeedLimitsMode')
    expect(lastCall().init.method).toBe('POST')
  })
})

describe('who did not answer', () => {
  it('takes a failure without the bridge’s mark for Kinopeer’s: a proxy in front answered for the server', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
    const error = await getAppVersion().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KinopeerUnreachableError)
    expect(error).toMatchObject({ status: 502 })
    expect(unreachable(error)).toBe('kinopeer')
  })

  it('takes the bridge’s own failure for qBittorrent’s', async () => {
    respond('qBittorrent is unreachable', 502)
    const error = await getAppVersion().catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(KinopeerUnreachableError)
    expect(unreachable(error)).toBe('qbittorrent')
  })

  it('takes a failed network and a sign-in proxy for Kinopeer unreached, a request that took too long for qBittorrent', () => {
    expect(unreachable(new TypeError('Failed to fetch'))).toBe('unreached')
    expect(unreachable(new ProxySignInError())).toBe('unreached')
    expect(unreachable(new DOMException('The operation was aborted.', 'AbortError'))).toBe('qbittorrent')
  })
})
