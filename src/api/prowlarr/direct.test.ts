import { beforeEach, describe, expect, it, onTestFinished, vi, type Mock } from 'vitest'
import { PROWLARR_ADDRESS as PROWLARR, opaqueRedirect } from '../../test/fixtures'
import { UnauthorizedError } from '../qbittorrent/errors'
import { SETTING_KEYS } from '../settings/webui'
import { FAILING_TIMEOUT_MS, downloadDirect, failingDirect, searchDirect, statusDirect } from './direct'
import { ProwlarrError, ProwlarrKeyReadError, ProwlarrSetupError } from './errors'

let fetchMock: Mock<typeof fetch>

/** What the page's fake qBittorrent keeps in its store for web interfaces. */
let kept: Record<string, unknown>

/** Prowlarr's answer to each call, by its path. */
let answers: Record<string, () => Promise<Response> | Response>

const KEY = 'prowlarr-key'

/** The calls that went to Prowlarr, not qBittorrent's store. */
const prowlarrCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(PROWLARR))

beforeEach(() => {
  kept = { [SETTING_KEYS.prowlarr]: { url: PROWLARR, apiKey: KEY } }
  answers = {}
  fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (String(url).startsWith('api/v2/clientdata/load')) return Response.json(kept)
    const { pathname } = new URL(String(url))
    return answers[pathname]?.() ?? new Response('Not Found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('__WEBUI__', true)
  vi.stubGlobal('location', new URL('http://192.168.1.20:8080/'))
})

describe('searchDirect', () => {
  it('searches Prowlarr with the key in its header, with no cookie, and keeps the key out of the releases', async () => {
    answers['/api/v1/search'] = () =>
      Response.json([
        {
          guid: 'g1',
          title: 'Dune.2021.2160p.WEB-DL-GRPA',
          indexer: 'Indexer A',
          size: 10,
          protocol: 'torrent',
          downloadUrl: `${PROWLARR}/1/download?apikey=${KEY}&link=abc&file=Dune`,
        },
        // Usenet, which Kinopeer doesn't add.
        { guid: 'g2', title: 'Dune', protocol: 'usenet', downloadUrl: `${PROWLARR}/2/download?apikey=${KEY}&link=x` },
      ])
    const releases = await searchDirect('Dune', 'movie', [2000])
    const [[url, init]] = prowlarrCalls()
    expect(String(url)).toBe(`${PROWLARR}/api/v1/search?query=Dune&type=movie&limit=100&categories=2000`)
    expect(init?.headers).toEqual({ 'X-Api-Key': KEY, Accept: 'application/json' })
    expect(init?.credentials).toBeUndefined()
    expect(releases).toEqual([expect.objectContaining({ id: 'g1', download: '1/download?link=abc&file=Dune' })])
    expect(JSON.stringify(releases)).not.toContain(KEY)
  })

  it('says Prowlarr isn’t set up without an address and key in qBittorrent, and asks it nothing', async () => {
    kept = {}
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ name: 'ProwlarrSetupError', code: 'not-configured' })
    expect(prowlarrCalls()).toEqual([])
  })

  it('reads a 401 as a key Prowlarr refuses, and anything else but its list as an answer that isn’t Prowlarr’s', async () => {
    answers['/api/v1/search'] = () => new Response(null, { status: 401 })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ name: 'ProwlarrSetupError', code: 'unauthorized' })
    answers['/api/v1/search'] = () => new Response('Bad Gateway', { status: 502 })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ name: 'ProwlarrError', code: 'upstream' })
    // A proxy's sign-in page, say.
    answers['/api/v1/search'] = () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ code: 'upstream' })
    answers['/api/v1/search'] = () => Response.json({ message: 'not a list' })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ code: 'upstream' })
    // Another app's 404 at the address is no release of Prowlarr's gone.
    answers['/api/v1/search'] = () => new Response('Not Found', { status: 404 })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ code: 'upstream' })
  })

  it('frees the connection of a refusal rather than leave its body unread', async () => {
    const cancel = vi.fn()
    answers['/api/v1/search'] = () => new Response(new ReadableStream({ cancel }), { status: 502 })
    await expect(searchDirect('Dune', 'search', [])).rejects.toMatchObject({ code: 'upstream' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('passes on the abort of a caller that gave the search up while its answer was read', async () => {
    const caller = new AbortController()
    // Pulled only once the answer is read, not as it's made.
    const body = new ReadableStream(
      {
        pull(controller) {
          caller.abort()
          controller.error(new DOMException('Aborted', 'AbortError'))
        },
      },
      { highWaterMark: 0 },
    )
    answers['/api/v1/search'] = () => new Response(body, { headers: { 'Content-Type': 'application/json' } })
    const error = await searchDirect('Dune', 'search', [], caller.signal).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  it('passes on what fetch throws when Prowlarr doesn’t answer', async () => {
    const failure = new TypeError('Failed to fetch')
    answers['/api/v1/search'] = () => Promise.reject(failure)
    await expect(searchDirect('Dune', 'search', [])).rejects.toBe(failure)
  })

  it.each([
    ["qBittorrent's session ended", () => Promise.resolve(new Response('Forbidden', { status: 403 })), UnauthorizedError],
    ["qBittorrent doesn't answer", () => Promise.reject(new TypeError('Failed to fetch')), TypeError],
  ] as const)("tells an address and key qBittorrent didn't give from Prowlarr's failures, and asks Prowlarr nothing: %s", async (_case, load, cause) => {
    fetchMock.mockImplementationOnce(load)
    const error = await searchDirect('Dune', 'search', []).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProwlarrKeyReadError)
    expect((error as ProwlarrKeyReadError).cause).toBeInstanceOf(cause)
    expect(prowlarrCalls()).toEqual([])
  })

  it('passes on the abort of a caller that gave the search up while the key was read, as any other call’s', async () => {
    const caller = new AbortController()
    fetchMock.mockImplementationOnce(() => {
      caller.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })
    const error = await searchDirect('Dune', 'search', [], caller.signal).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})

describe('statusDirect', () => {
  it('says Prowlarr’s version and how many indexers are enabled', async () => {
    answers['/api/v1/system/status'] = () => Response.json({ version: '3.0.2.5780' })
    answers['/api/v1/indexer'] = () => Response.json([{ id: 1, enable: true }, { id: 2, enable: false }, { id: 3, enable: true }])
    await expect(statusDirect()).resolves.toEqual({ version: '3.0.2.5780', indexers: 2 })
    expect(prowlarrCalls().map(([, init]) => init?.headers)).toEqual([
      { 'X-Api-Key': KEY, Accept: 'application/json' },
      { 'X-Api-Key': KEY, Accept: 'application/json' },
    ])
  })

  it('reads a status that isn’t JSON as an answer that isn’t Prowlarr’s', async () => {
    answers['/api/v1/system/status'] = () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })
    answers['/api/v1/indexer'] = () => Response.json([])
    await expect(statusDirect()).rejects.toMatchObject({ name: 'ProwlarrError', code: 'upstream' })
  })

  it('reads an indexer list that isn’t JSON as an answer that isn’t Prowlarr’s, not as no indexers', async () => {
    answers['/api/v1/system/status'] = () => Response.json({ version: '3.0.2.5780' })
    answers['/api/v1/indexer'] = () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })
    await expect(statusDirect()).rejects.toMatchObject({ name: 'ProwlarrError', code: 'upstream' })
  })

  it.each([['null', null], ['a string', 'ok']])('reads a status of %s as an answer that isn’t Prowlarr’s', async (_case, system) => {
    answers['/api/v1/system/status'] = () => Response.json(system)
    answers['/api/v1/indexer'] = () => Response.json([])
    await expect(statusDirect()).rejects.toMatchObject({ name: 'ProwlarrError', code: 'upstream' })
  })

  it('reads a 401 on either as a key Prowlarr refuses', async () => {
    answers['/api/v1/system/status'] = () => Response.json({ version: '3.0.2.5780' })
    answers['/api/v1/indexer'] = () => new Response(null, { status: 401 })
    await expect(statusDirect()).rejects.toBeInstanceOf(ProwlarrSetupError)
  })
})

describe('failingDirect', () => {
  const now = Date.parse('2026-11-22T12:00:00Z')

  it('names the enabled indexers that failed since the search started, by this device’s clock', async () => {
    vi.useFakeTimers({ now, toFake: ['Date'] })
    onTestFinished(() => void vi.useRealTimers())
    answers['/api/v1/indexerstatus'] = () =>
      Response.json([
        { indexerId: 1, mostRecentFailure: '2026-11-22T11:59:30Z' },
        // Before the search started a minute ago.
        { indexerId: 2, mostRecentFailure: '2026-11-22T11:58:00Z' },
      ])
    answers['/api/v1/indexer'] = () => Response.json([{ id: 1, name: 'Indexer A', enable: true }, { id: 2, name: 'Indexer B', enable: true }])
    await expect(failingDirect(60_000)).resolves.toEqual(['Indexer A'])
  })

  it('asks for the indexer list only to name a failure', async () => {
    answers['/api/v1/indexerstatus'] = () => Response.json([])
    await expect(failingDirect(60_000)).resolves.toEqual([])
    expect(prowlarrCalls().map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/v1/indexerstatus'])
  })

  it('reads an answer that isn’t a list as one that isn’t Prowlarr’s', async () => {
    answers['/api/v1/indexerstatus'] = () => Response.json({})
    await expect(failingDirect(60_000)).rejects.toMatchObject({ code: 'upstream' })
    answers['/api/v1/indexerstatus'] = () => Response.json([{ indexerId: 1, disabledTill: '2999-01-01T00:00:00Z' }])
    answers['/api/v1/indexer'] = () => Response.json({})
    await expect(failingDirect(60_000)).rejects.toMatchObject({ code: 'upstream' })
  })

  it('gives up when Prowlarr doesn’t answer in time', async () => {
    vi.useFakeTimers()
    onTestFinished(() => void vi.useRealTimers())
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).startsWith('api/v2/clientdata/load')) return Response.json(kept)
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    const error = failingDirect(60_000).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(FAILING_TIMEOUT_MS - 1)
    expect(await Promise.race([error, 'waiting'])).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    await expect(error).resolves.toMatchObject({ name: 'AbortError' })
  })
})

describe('downloadDirect', () => {
  const TORRENT = new Uint8Array([0x64, 0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f, 0x65])

  it('gets the .torrent with the key in the link’s query, no header that needs a preflight, and no redirect followed', async () => {
    answers['/api/v1/indexer/12/download'] = () => new Response(TORRENT, { headers: { 'Content-Type': 'application/x-bittorrent' } })
    await expect(downloadDirect('12/download?link=abc&file=Dune')).resolves.toEqual({ kind: 'file', bytes: TORRENT })
    const [[url, init]] = prowlarrCalls()
    expect(String(url)).toBe(`${PROWLARR}/api/v1/indexer/12/download?link=abc&file=Dune&apikey=${KEY}`)
    expect(init?.headers).toBeUndefined()
    expect(init?.redirect).toBe('manual')
  })

  it('hands qBittorrent the link, key and all, when Prowlarr answers with a redirect the page can’t read', async () => {
    answers['/api/v1/indexer/12/download'] = opaqueRedirect
    await expect(downloadDirect('12/download?link=abc')).resolves.toEqual({
      kind: 'link',
      url: `${PROWLARR}/api/v1/indexer/12/download?link=abc&apikey=${KEY}`,
    })
  })

  it('reads a 401 as a refused key, a 404 as a release Prowlarr no longer has, and anything but a .torrent as no answer of Prowlarr’s', async () => {
    answers['/api/v1/indexer/12/download'] = () => new Response(null, { status: 401 })
    await expect(downloadDirect('12/download?link=abc')).rejects.toBeInstanceOf(ProwlarrSetupError)
    answers['/api/v1/indexer/12/download'] = () => new Response(null, { status: 404 })
    await expect(downloadDirect('12/download?link=abc')).rejects.toMatchObject({ code: 'not-found' })
    answers['/api/v1/indexer/12/download'] = () => new Response(null, { status: 500 })
    await expect(downloadDirect('12/download?link=abc')).rejects.toMatchObject({ code: 'upstream' })
    answers['/api/v1/indexer/12/download'] = () => new Response('<html>Sign in</html>')
    await expect(downloadDirect('12/download?link=abc')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('downloads nothing for anything but a download token', async () => {
    await expect(downloadDirect('../system/status')).rejects.toBeInstanceOf(ProwlarrError)
    expect(prowlarrCalls()).toEqual([])
  })
})
