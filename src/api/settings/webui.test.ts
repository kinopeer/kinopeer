import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { sharedRequests } from '../../logic/sharedRequests'
import { SERVER_SETTINGS_KEY, forgetTmdbKey, getServerSettings, saveDownloadDefaults, saveProwlarrKey, saveTmdbKey } from './client'
import { UnauthorizedError } from '../qbittorrent/errors'
import { KEY_CHECK_TIMEOUT_MS } from '../tmdb/direct'
import { SettingsError } from './errors'
import type { ServerSettings } from './types'
import {
  SETTING_KEYS,
  WEBUI_SETTINGS_KEY,
  asServerSettings,
  getWebuiSettings,
  prowlarrAddress,
  readSettings,
  saveWebuiDownloadDefaults,
  PROWLARR_CHECK_TIMEOUT_MS,
  FIND_TIMEOUT_MS,
  findWebuiProwlarr,
  prowlarrCandidates,
  isMixedContent,
  saveWebuiProwlarr,
  saveWebuiTmdbKey,
  sharedTmdbAvailable,
} from './webui'

let fetchMock: Mock<typeof fetch>

/** What the page's fake qBittorrent keeps in its store, merged as qBittorrent 5.3 does (src/api/qbittorrent/webui.test.ts). */
let kept: Record<string, unknown>

/** The `data` of each `clientdata/store` sent. */
const stored = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/clientdata/store'))
    .map(([, init]) => JSON.parse(new URLSearchParams(String(init!.body)).get('data')!) as Record<string, unknown>)

beforeEach(() => {
  kept = {}
  fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url), 'http://192.168.1.20:8080/')
    if (target.pathname === '/api/v2/clientdata/load') {
      const keys = JSON.parse(target.searchParams.get('keys')!) as string[]
      return Response.json(Object.fromEntries(keys.filter((key) => key in kept).map((key) => [key, kept[key]])))
    }
    if (target.pathname === '/api/v2/clientdata/store') {
      const data = JSON.parse(new URLSearchParams(String(init!.body)).get('data')!) as Record<string, unknown>
      for (const [key, value] of Object.entries(data)) {
        if (value === null) delete kept[key]
        else kept[key] = value
      }
      return new Response(null, { status: 204 })
    }
    // TMDB's check of a key (`checkTmdbKey`), which takes any key unless a test says otherwise.
    if (target.origin === 'https://api.themoviedb.org' && target.pathname === '/3/authentication') return tmdbAccepts()
    // Prowlarr's check of a key (`checkProwlarrKey`), which takes any key unless a test says otherwise.
    if (target.pathname === '/api/v1/system/status') return prowlarrAccepts()
    return new Response('Not Found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('__WEBUI__', true)
  vi.stubGlobal('__TMDB_PROXY__', 'https://tmdb.example.test/3')
  // jsdom's page is on localhost, which the proxy answers; a test on a public origin says so.
  vi.stubGlobal('location', new URL('http://192.168.1.20:8080/'))
})

/** Prowlarr's status, its answer to a key it takes. */
const prowlarrAccepts = () => Response.json({ appName: 'Prowlarr', version: '3.0.2.5780' })

/** TMDB's answer to a key it takes. */
const tmdbAccepts = () => Response.json({ success: true, status_code: 1, status_message: 'Success.' })

/** The path of each call sent, TMDB's and qBittorrent's alike. */
const paths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://192.168.1.20:8080/').pathname)

// The key's time limit runs on fake timers.
afterEach(() => {
  vi.useRealTimers()
})

const onPublicOrigin = () => vi.stubGlobal('location', new URL('https://qbt.example.com/'))

describe('readSettings', () => {
  it('reads each setting from its own key, a category kept as automatic among them', () => {
    expect(
      readSettings({
        'kinopeer.tmdbKey': 'tmdb-key',
        'kinopeer.prowlarr': { url: 'http://192.168.1.20:9696', apiKey: 'prowlarr-key' },
        'kinopeer.downloads.movieCategory': 'Movies',
        'kinopeer.downloads.tvCategory': '',
        'kinopeer.downloads.startPaused': true,
        'kinopeer.downloads.sequential': false,
        'kinopeer.downloads.mediaNames': true,
      }),
    ).toEqual({
      tmdbKey: 'tmdb-key',
      prowlarr: { url: 'http://192.168.1.20:9696', apiKey: 'prowlarr-key' },
      downloads: { movieCategory: 'Movies', tvCategory: null, startPaused: true, sequential: false, mediaNames: true },
    })
  })

  it('leaves out what is not the shape it writes, as a hand edit or another version may leave', () => {
    expect(
      readSettings({
        'kinopeer.tmdbKey': '',
        'kinopeer.prowlarr': { url: 'http://192.168.1.20:9696' },
        'kinopeer.downloads.tvCategory': null,
        'kinopeer.downloads.movieCategory': true,
        'kinopeer.downloads.startPaused': 'yes',
        'other.interface': { theme: 'dark' },
      }),
    ).toEqual({ tmdbKey: null, prowlarr: null, downloads: {} })
    expect(readSettings({ 'kinopeer.prowlarr': null })).toEqual({ tmdbKey: null, prowlarr: null, downloads: {} })
    // A key without the address it belongs to.
    expect(readSettings({ 'kinopeer.prowlarr': { apiKey: 'prowlarr-key' } })).toEqual({ tmdbKey: null, prowlarr: null, downloads: {} })
  })
})

describe('asServerSettings', () => {
  const none = { tmdbKey: null, prowlarr: null, downloads: {} }

  it("names Kinopeer's key where the proxy answers the page, with the user's own to go back from", () => {
    expect(asServerSettings(none, true).tmdb).toEqual({ configured: true, source: 'shared', fallback: null })
    expect(asServerSettings({ ...none, tmdbKey: 'k' }, true).tmdb).toEqual({ configured: true, source: 'saved', fallback: 'shared' })
  })

  it("asks for a key of the user's own where the proxy doesn't answer the page, with nothing to go back to", () => {
    expect(asServerSettings(none, false).tmdb).toEqual({ configured: false, source: null, fallback: null })
    expect(asServerSettings({ ...none, tmdbKey: 'k' }, false).tmdb).toEqual({ configured: true, source: 'saved', fallback: null })
  })

  it("gives Prowlarr's address in full and only whether its key is set, and nothing a server would keep", () => {
    const settings = asServerSettings({ ...none, prowlarr: { url: 'http://192.168.1.20:9696', apiKey: 'secret' }, downloads: { sequential: true } }, true)
    expect(settings.prowlarr).toEqual({ configured: true, source: 'saved', address: { source: 'saved', url: 'http://192.168.1.20:9696' }, serverKey: false })
    expect(JSON.stringify(settings)).not.toContain('secret')
    expect(settings.downloads).toEqual({ sequential: true })
    // The page's own qBittorrent, with no login or address of the app's to keep.
    expect(settings.qbittorrent).toEqual({ configured: true, source: null, address: { source: null } })
    expect(settings).not.toHaveProperty('auth')
    expect(settings).not.toHaveProperty('telegram')
    expect(asServerSettings(none, true).prowlarr).toEqual({ configured: false, source: null, address: { source: null }, serverKey: false })
  })
})

describe('sharedTmdbAvailable', () => {
  it("follows the page's origin, as the proxy reads it", () => {
    expect(sharedTmdbAvailable()).toBe(true)
    onPublicOrigin()
    expect(sharedTmdbAvailable()).toBe(false)
  })

  it('is off on any origin in a build with no proxy', () => {
    vi.stubGlobal('__TMDB_PROXY__', '')
    expect(sharedTmdbAvailable()).toBe(false)
  })
})

describe('prowlarrAddress', () => {
  /** An address of `length` characters. */
  const addressOf = (length: number) => `http://nas.local/${'x'.repeat(length - 'http://nas.local/'.length)}`

  it('takes an http or https address, its path kept for a reverse proxy, without trailing slashes', () => {
    expect(prowlarrAddress(' http://192.168.1.20:9696/ ')).toBe('http://192.168.1.20:9696')
    expect(prowlarrAddress('https://nas.local/prowlarr//')).toBe('https://nas.local/prowlarr')
    // As long as the server takes one (server/address.ts), and no longer (below).
    expect(prowlarrAddress(addressOf(2048))).toBe(addressOf(2048))
  })

  it.each(['192.168.1.20:9696', 'ftp://nas.local', 'http://user:pass@nas.local', 'http://user@nas.local', 'http://:pass@nas.local', 'http://nas.local/?apikey=1', 'http://nas.local/#x', '', addressOf(2049)])(
    'refuses %j',
    (value) => {
      expect(prowlarrAddress(value)).toBeUndefined()
    },
  )
})

describe('SettingsError', () => {
  it('names its code in its message, else its status', () => {
    expect(new SettingsError(409, 'store-full').message).toBe('Settings request failed (store-full)')
    expect(new SettingsError(502).message).toBe('Settings request failed (502)')
  })
})

describe('the settings in qBittorrent', () => {
  it('asks qBittorrent anew each time the settings are loaded, and shares that answer with the clients that call with the keys', async () => {
    kept['kinopeer.tmdbKey'] = 'first'
    await getServerSettings()
    kept['kinopeer.tmdbKey'] = 'second'
    expect((await getServerSettings()).tmdb.source).toBe('saved')
    expect((await getWebuiSettings()).tmdbKey).toBe('second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stores a download default under its own key alone, so another device changing another keeps its change', async () => {
    await getServerSettings()
    // Another device sets its own default meanwhile.
    kept['kinopeer.downloads.sequential'] = true
    await saveDownloadDefaults({ startPaused: true })
    expect(stored()).toEqual([{ 'kinopeer.downloads.startPaused': true }])
    expect(kept).toEqual({ 'kinopeer.downloads.startPaused': true, 'kinopeer.downloads.sequential': true })
  })

  it.each([
    ['in the order sent', [0, 1]],
    ['the other way round', [1, 0]],
  ])('keeps both of two saves on their way at once in the page\'s answer, settled %s', async (_order, order) => {
    await getServerSettings()
    const held: (() => void)[] = []
    const store = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, init) =>
      String(url).endsWith('/clientdata/store') ? new Promise<Response>((resolve) => held.push(() => resolve(store(url, init)))) : store(url, init),
    )
    const saves = [saveDownloadDefaults({ startPaused: true }), saveDownloadDefaults({ sequential: true })]
    await vi.waitFor(() => expect(held).toHaveLength(2))
    for (const index of order) {
      held[index]()
      await saves[index]
    }
    expect(sharedRequests.peek(WEBUI_SETTINGS_KEY, Infinity)?.data).toEqual({ 'kinopeer.downloads.startPaused': true, 'kinopeer.downloads.sequential': true })
    expect(sharedRequests.peek<ServerSettings>(SERVER_SETTINGS_KEY, Infinity)?.data?.downloads).toEqual({ startPaused: true, sequential: true })
  })

  it("answers from what it read when the page's answer was forgotten while it was on its way", async () => {
    kept['kinopeer.downloads.sequential'] = true
    await getServerSettings()
    let release = () => {}
    const store = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, init) =>
      String(url).endsWith('/clientdata/store') ? new Promise<Response>((resolve) => (release = () => resolve(store(url, init)))) : store(url, init),
    )
    const save = saveDownloadDefaults({ startPaused: true })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    sharedRequests.clear()
    release()
    await expect(save).resolves.toMatchObject({ downloads: { sequential: true, startPaused: true } })
  })

  it("keeps a category picked automatically as a value, so a device that had picked one doesn't send it back", async () => {
    // A default left undefined isn't among the changes.
    await saveWebuiDownloadDefaults({ movieCategory: null, tvCategory: 'Series', sequential: undefined })
    expect(stored()).toEqual([{ 'kinopeer.downloads.movieCategory': '', 'kinopeer.downloads.tvCategory': 'Series' }])
    expect((await getWebuiSettings(undefined, true)).downloads).toEqual({ movieCategory: null, tvCategory: 'Series' })
  })

  it("answers a save with the page's settings and what it stored, which every caller then reads", async () => {
    kept['kinopeer.downloads.sequential'] = true
    await getServerSettings()
    const answer = await saveTmdbKey('own-key')
    expect(answer.tmdb.source).toBe('saved')
    expect(answer.downloads).toEqual({ sequential: true })
    expect(sharedRequests.peek<ServerSettings>(SERVER_SETTINGS_KEY, Infinity)?.data).toEqual(answer)
    await expect(getWebuiSettings()).resolves.toMatchObject({ tmdbKey: 'own-key' })
    // Taken from the save, not asked again: the load, TMDB's check of the key and the store.
    expect(paths()).toEqual(['/api/v2/clientdata/load', '/3/authentication', '/api/v2/clientdata/store'])
  })

  it('asks qBittorrent what it keeps before a save when the page has nothing from it yet, and stores nothing when that fails', async () => {
    kept['kinopeer.downloads.sequential'] = true
    await expect(saveWebuiTmdbKey('own-key')).resolves.toMatchObject({ tmdb: { source: 'saved' }, downloads: { sequential: true } })
    expect(paths()).toEqual(['/3/authentication', '/api/v2/clientdata/load', '/api/v2/clientdata/store'])
    expect(sharedRequests.peek(WEBUI_SETTINGS_KEY, Infinity)?.data).toEqual({ 'kinopeer.tmdbKey': 'own-key', 'kinopeer.downloads.sequential': true })

    // A save that would succeed isn't failed by a read after it: the read comes first, and fails it before anything is stored.
    sharedRequests.clear()
    // TMDB takes the key; qBittorrent doesn't answer the read.
    fetchMock.mockResolvedValueOnce(tmdbAccepts()).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(saveWebuiTmdbKey('other-key')).rejects.toBeInstanceOf(TypeError)
    expect(stored()).toHaveLength(1)
    expect(kept['kinopeer.tmdbKey']).toBe('own-key')
  })

  it("forgets the user's TMDB key for Kinopeer's where the proxy answers the page, and refuses elsewhere", async () => {
    kept['kinopeer.tmdbKey'] = 'own-key'
    await getServerSettings()
    await expect(forgetTmdbKey()).resolves.toMatchObject({ tmdb: { source: 'shared' } })
    expect(stored()).toEqual([{ 'kinopeer.tmdbKey': null }])
    expect(kept).toEqual({})
    expect(sharedRequests.peek(WEBUI_SETTINGS_KEY, Infinity)?.data).toEqual({})

    onPublicOrigin()
    await expect(forgetTmdbKey()).rejects.toMatchObject({ code: 'no-server-key' })
    expect(stored()).toHaveLength(1)
  })

  it('checks the TMDB key with TMDB before it stores it, trimmed, and a v4 token as a bearer token', async () => {
    await saveTmdbKey('  own-key \n')
    const [checked, init] = fetchMock.mock.calls[0]!
    expect(String(checked)).toBe('https://api.themoviedb.org/3/authentication?api_key=own-key')
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
    expect(stored()).toEqual([{ [SETTING_KEYS.tmdbKey]: 'own-key' }])

    fetchMock.mockClear()
    await saveTmdbKey('eyJ.token')
    const [url, sent] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.themoviedb.org/3/authentication')
    expect(new Headers(sent?.headers).get('Authorization')).toBe('Bearer eyJ.token')
  })

  it.each([
    ['TMDB refuses the key', 'invalid-key', 422, () => Promise.resolve(Response.json({ success: false }, { status: 401 }))],
    ['TMDB answers with an error', 'unreachable', 502, () => Promise.resolve(new Response('Bad Gateway', { status: 502 }))],
    ['nothing answers', 'unreachable', 502, () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('stores no TMDB key when %s, and says so as the server does', async (_case, code, status, check) => {
    fetchMock.mockImplementationOnce(check)
    const error = await saveTmdbKey('own-key').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SettingsError)
    expect(error).toMatchObject({ status, code })
    expect(stored()).toEqual([])
  })

  it("gives up the key's check when TMDB doesn't answer in time", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(
      (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    )
    const error = saveTmdbKey('own-key').catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS)
    await expect(error).resolves.toMatchObject({ code: 'unreachable' })
    expect(stored()).toEqual([])
  })

  it('refuses a TMDB key with a space inside without asking TMDB, as the server does', async () => {
    await expect(saveTmdbKey('own key')).rejects.toMatchObject({ code: 'bad-request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an empty key without storing it, as the server does', async () => {
    await expect(saveTmdbKey('')).rejects.toMatchObject({ code: 'bad-request' })
    await expect(saveTmdbKey('   ')).rejects.toMatchObject({ code: 'bad-request' })
    await expect(saveProwlarrKey('', 'http://192.168.1.20:9696')).rejects.toMatchObject({ code: 'bad-request' })
    expect(stored()).toEqual([])
  })

  it("keeps Prowlarr's address and key under one key, the address as the browser will call it, once Prowlarr takes the key", async () => {
    await saveProwlarrKey(' prowlarr-key ', 'http://192.168.1.20:9696/')
    const check = fetchMock.mock.calls.find(([url]) => String(url) === 'http://192.168.1.20:9696/api/v1/system/status')
    expect(check?.[1]?.headers).toEqual({ 'X-Api-Key': 'prowlarr-key', Accept: 'application/json' })
    expect(paths()).toEqual(['/api/v1/system/status', '/api/v2/clientdata/load', '/api/v2/clientdata/store'])
    expect(stored()).toEqual([{ [SETTING_KEYS.prowlarr]: { url: 'http://192.168.1.20:9696', apiKey: 'prowlarr-key' } }])
  })

  it.each([
    ['refuses the key', async () => new Response(null, { status: 401 }), 422, 'invalid-key'],
    ['answers with something but Prowlarr', async () => new Response('<html>Sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 502, 'not-prowlarr'],
    ['answers with an error of its own', async () => new Response(null, { status: 503 }), 502, 'unreachable'],
    ['doesn’t answer', () => Promise.reject(new TypeError('Failed to fetch')), 502, 'unreachable'],
  ] as const)("stores no Prowlarr key when Prowlarr %s, as the server does", async (_case, answer, status, code) => {
    fetchMock.mockImplementationOnce(answer)
    await expect(saveWebuiProwlarr('prowlarr-key', 'http://192.168.1.20:9696')).rejects.toMatchObject({ status, code })
    expect(stored()).toEqual([])
  })

  it("gives up the Prowlarr key's check when Prowlarr doesn't answer in time", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(
      (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    )
    const error = saveWebuiProwlarr('prowlarr-key', 'http://192.168.1.20:9696').catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(PROWLARR_CHECK_TIMEOUT_MS - 1)
    expect(await Promise.race([error, 'waiting'])).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    await expect(error).resolves.toMatchObject({ code: 'unreachable' })
    expect(stored()).toEqual([])
  })

  it.each([
    ['http:', 'http://192.168.1.20:9696', false],
    ['https:', 'http://192.168.1.20:9696', true],
    ['https:', 'http://nas.local:9696', true],
    ['https:', 'https://192.168.1.20:9696', false],
    // A loopback address is one the browser trusts over plain HTTP too.
    ['https:', 'http://localhost:9696', false],
    ['https:', 'http://prowlarr.localhost', false],
    ['https:', 'http://127.0.0.1:9696', false],
    ['https:', 'http://127.10.20.30:9696', false],
    // Only an address that is all loopback: a LAN one with 127 in it, or a name that starts with one, isn't.
    ['https:', 'http://10.127.0.1:9696', true],
    ['https:', 'http://127.0.0.1.example.test:9696', true],
    ['https:', 'http://[::1]:9696', false],
    [undefined, 'http://192.168.1.20:9696', false],
  ] as const)('reads a page at %s calling %s as mixed content: %s', (page, address, mixed) => {
    expect(isMixedContent(page, address)).toBe(mixed)
  })

  it('refuses a plain HTTP address for Prowlarr on a page served over HTTPS, without asking it', async () => {
    vi.stubGlobal('location', new URL('https://qbt.example.com/'))
    await expect(saveWebuiProwlarr('prowlarr-key', 'http://192.168.1.20:9696')).rejects.toMatchObject({ status: 400, code: 'mixed-content' })
    expect(fetchMock).not.toHaveBeenCalled()
    await saveWebuiProwlarr('prowlarr-key', 'https://prowlarr.example.com')
    expect(kept[SETTING_KEYS.prowlarr]).toEqual({ url: 'https://prowlarr.example.com', apiKey: 'prowlarr-key' })
  })

  it('saves a new key at the address kept before, and refuses without one or with one that is no address', async () => {
    await expect(saveWebuiProwlarr('prowlarr-key')).rejects.toMatchObject({ status: 409, code: 'not-configured' })
    await expect(saveWebuiProwlarr('prowlarr-key', 'nas:9696')).rejects.toMatchObject({ status: 400, code: 'invalid-address' })
    expect(stored()).toEqual([])

    kept[SETTING_KEYS.prowlarr] = { url: 'http://192.168.1.20:9696', apiKey: 'old' }
    // The page's settings from before, which a save without an address reads, are asked again.
    sharedRequests.clear()
    await saveWebuiProwlarr('new')
    expect(kept[SETTING_KEYS.prowlarr]).toEqual({ url: 'http://192.168.1.20:9696', apiKey: 'new' })
  })

  it("says qBittorrent's store had no room, and keeps the page's settings as they were", async () => {
    kept['kinopeer.tmdbKey'] = 'old'
    await getServerSettings()
    fetchMock
      .mockResolvedValueOnce(tmdbAccepts())
      .mockResolvedValueOnce(new Response('Total web client data must not be larger than 1048576 bytes', { status: 409 }))
    const error = await saveTmdbKey('new').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SettingsError)
    expect(error).toMatchObject({ code: 'store-full' })
    await expect(getWebuiSettings()).resolves.toMatchObject({ tmdbKey: 'old' })
  })

  it("passes on qBittorrent's other refusals as they are", async () => {
    await getServerSettings()
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    await expect(saveWebuiDownloadDefaults({ sequential: true })).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('Find for Prowlarr in the WebUI build (#560)', () => {
  it.each([
    ['qBittorrent’s host and the usual name from a page on the home network', 'http://192.168.1.20:8080/', ['http://192.168.1.20:9696', 'http://prowlarr:9696']],
    ['this device once from a page on it', 'http://127.0.0.1:8080/', ['http://127.0.0.1:9696', 'http://prowlarr:9696']],
    ['this device once from a page at localhost', 'http://localhost:8080/', ['http://localhost:9696', 'http://prowlarr:9696']],
    ['an IPv6 host in brackets', 'http://[fd00::20]:8080/', ['http://[fd00::20]:9696', 'http://prowlarr:9696']],
    // A page over HTTPS can call plain HTTP only on this device, the one address left to try.
    ['this device alone from a page over HTTPS', 'https://qbt.example.com/', ['http://localhost:9696']],
    ['this device once from a page on it over HTTPS', 'https://[::1]:8080/', ['http://[::1]:9696']],
  ])('looks at %s', (_case, page, candidates) => {
    expect(prowlarrCandidates(new URL(page))).toEqual(candidates)
  })

  it('answers the addresses where Prowlarr’s API refuses a call without a key, in the list’s order however they answer', async () => {
    const cancel = vi.fn()
    let hostAnswers: (response: Response) => void = () => {}
    fetchMock.mockImplementation(async (url) => {
      const { host } = new URL(String(url))
      // Prowlarr at qBittorrent's host, which answers after the one at the usual name.
      if (host === '192.168.1.20:9696') return new Promise<Response>((resolve) => (hostAnswers = resolve))
      // Prowlarr at the usual name: its API's 401, which it lets any origin read.
      return new Response(new ReadableStream({ cancel }), { status: 401 })
    })
    const found = findWebuiProwlarr()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    hostAnswers(new Response(null, { status: 401 }))
    await expect(found).resolves.toEqual(['http://192.168.1.20:9696', 'http://prowlarr:9696'])
    // A plain GET with no header, which needs no preflight.
    expect(fetchMock.mock.calls.every(([, init]) => init?.headers === undefined && init?.method === undefined)).toBe(true)
    // The connection freed rather than left with its body unread.
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('leaves out an address where nothing answers or another service answers otherwise', async () => {
    fetchMock.mockImplementation(async (url) => {
      // Nothing listens at qBittorrent's host on Prowlarr's port.
      if (new URL(String(url)).host === '192.168.1.20:9696') throw new TypeError('Failed to fetch')
      // Another service at the usual name.
      return Response.json({ version: '1' })
    })
    await expect(findWebuiProwlarr()).resolves.toEqual([])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['http://192.168.1.20:9696/api/v1/system/status', 'http://prowlarr:9696/api/v1/system/status'])
  })

  it('waits for each address no longer than its time limit', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).host === 'prowlarr:9696') return new Response(null, { status: 401 })
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    const found = findWebuiProwlarr()
    await vi.advanceTimersByTimeAsync(FIND_TIMEOUT_MS - 1)
    expect(await Promise.race([found, 'waiting'])).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    await expect(found).resolves.toEqual(['http://prowlarr:9696'])
  })

  it('passes on the abort of a form closed while it looks', async () => {
    const caller = new AbortController()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    const found = findWebuiProwlarr(caller.signal)
    caller.abort()
    await expect(found).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('looks nowhere without a page, as in Node', async () => {
    vi.stubGlobal('location', undefined)
    await expect(findWebuiProwlarr()).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
