import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { QbittorrentError, UnauthorizedError } from './errors'
import { CLIENT_DATA_TIMEOUT_MS, LOGIN_TIMEOUT_MS, isStoreFull, loadClientData, logIn, storeClientData } from './webui'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('logIn', () => {
  it("posts the login to qBittorrent's own auth/login on the page's origin, so its cookie is the browser's", async () => {
    // qBittorrent 5.3 answers 204, earlier versions 200 "Ok.".
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(logIn('admin', 'p&ss=1')).resolves.toBe('ok')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('api/v2/auth/login')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(String(init!.body)).toBe('username=admin&password=p%26ss%3D1')

    fetchMock.mockResolvedValueOnce(new Response('Ok.'))
    await expect(logIn('admin', 'secret')).resolves.toBe('ok')
  })

  it('reads a wrong login the way 5.3 answers it and the way earlier versions do', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(logIn('admin', 'wrong')).resolves.toBe('invalid')
    fetchMock.mockResolvedValueOnce(new Response('Fails.\n'))
    await expect(logIn('admin', 'wrong')).resolves.toBe('invalid')
  })

  it('says when qBittorrent has banned the address after too many wrong logins', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Your IP address has been banned after too many failed authentication attempts.', { status: 403 }))
    await expect(logIn('admin', 'wrong')).resolves.toBe('banned')
  })

  it("throws any other refusal with qBittorrent's status, and fetch's TypeError when nothing answers", async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const error = await logIn('admin', 'secret').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(QbittorrentError)
    expect(error).toMatchObject({ status: 500 })

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(logIn('admin', 'secret')).rejects.toBeInstanceOf(TypeError)
  })

  // What a real fetch rejects with, and errors its body with, once the request's signal aborts.
  const aborted = () => new DOMException('Aborted', 'AbortError')
  const onAbort = (init: RequestInit | undefined, then: () => void) => init!.signal!.addEventListener('abort', then)

  it.each<[string, typeof fetch]>([
    ['no answer', (_url, init) => new Promise((_resolve, reject) => onAbort(init, () => reject(aborted())))],
    [
      'an answer whose body stops coming',
      async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('O'))
              onAbort(init, () => controller.error(aborted()))
            },
          }),
        ),
    ],
  ])('gives up a login in its time limit, so the form can be sent again: %s', async (_, stall) => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementationOnce(stall)
      let settled = false
      const login = logIn('admin', 'secret')
        .catch((caught: unknown) => caught)
        .finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const error = await login
      expect(error).toBeInstanceOf(DOMException)
      expect(error).not.toBeInstanceOf(QbittorrentError)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Checked against qBittorrent 5.3.0 in Docker (#558, #561): `clientdata/load` answers a GET with `keys`
// as a JSON array, only the keys it has, and one without `keys` every key it has; `clientdata/store` takes a POST whose `data` is a JSON object,
// answers 204, merges it key by key and removes a key sent as null; past 1 MiB for the whole store it
// answers 409 and keeps none of it.
describe('clientdata', () => {
  it("asks qBittorrent for Kinopeer's keys alone, as a JSON array in the query, and stops when the caller does", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ 'kinopeer.a': 1 }))
    await expect(loadClientData(['kinopeer.a', 'kinopeer.b'])).resolves.toEqual({ 'kinopeer.a': 1 })
    const [url, init] = fetchMock.mock.calls[0]
    const asked = new URL(String(url), 'http://qbt.test/')
    expect(asked.pathname).toBe('/api/v2/clientdata/load')
    expect(JSON.parse(asked.searchParams.get('keys')!)).toEqual(['kinopeer.a', 'kinopeer.b'])
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' })

    // The caller's abort reaches the request.
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))))
    const caller = new AbortController()
    const load = loadClientData(['kinopeer.a'], caller.signal)
    caller.abort()
    await expect(load).rejects.toThrow()
    expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(true)
  })

  it('asks qBittorrent for every key it keeps when no keys are named', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ 'kinopeer.a': 1, 'other.b': 2 }))
    await expect(loadClientData()).resolves.toEqual({ 'kinopeer.a': 1, 'other.b': 2 })
    const asked = new URL(String(fetchMock.mock.calls[0][0]), 'http://qbt.test/')
    expect(asked.pathname).toBe('/api/v2/clientdata/load')
    expect(asked.search).toBe('')
  })

  it.each([['an array', [1]], ['null', null], ['a string', 'x']])('reads an answer that is %s as nothing kept', async (_, answer) => {
    fetchMock.mockResolvedValueOnce(Response.json(answer))
    await expect(loadClientData(['kinopeer.a'])).resolves.toEqual({})
  })

  it('sends what it stores as one JSON object in a form, a null among it for a key to remove', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await storeClientData({ 'kinopeer.a': 'x', 'kinopeer.b': null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('api/v2/clientdata/store')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(new URLSearchParams(String(init!.body)).get('data')!)).toEqual({ 'kinopeer.a': 'x', 'kinopeer.b': null })
  })

  it.each([
    ['a store with no room', 409, 'Total web client data must not be larger than 1048576 bytes', QbittorrentError, true],
    ['data that is no object', 400, '`data` must be an object', QbittorrentError, false],
    ['a session that ended', 403, 'Forbidden', UnauthorizedError, false],
  ])("tells qBittorrent's refusal of %s apart", async (_name, status, text, kind, full) => {
    fetchMock.mockResolvedValueOnce(new Response(text, { status }))
    const error = await storeClientData({ 'kinopeer.a': 'x' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(kind)
    expect(isStoreFull(error)).toBe(full)
  })

  it.each([
    ['a load', () => loadClientData(['kinopeer.a'])],
    ['a store', () => storeClientData({ 'kinopeer.a': 'x' })],
  ])('gives up %s qBittorrent doesn\'t answer in its time limit', async (_name, call) => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))))
      let settled = false
      const request = call().catch((caught: unknown) => caught).finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(CLIENT_DATA_TIMEOUT_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await request).toMatchObject({ name: 'AbortError' })
    } finally {
      vi.useRealTimers()
    }
  })
})
