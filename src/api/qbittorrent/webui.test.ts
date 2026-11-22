import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { QbittorrentError } from './errors'
import { LOGIN_TIMEOUT_MS, logIn } from './webui'

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

  it('gives up a login qBittorrent hasn’t answered in its time limit, so the form can be sent again', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      )
      const login = logIn('admin', 'secret').catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS - 1)
      expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const error = await login
      expect(error).toBeInstanceOf(DOMException)
      expect(error).not.toBeInstanceOf(QbittorrentError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up an answer whose body stops coming in the same time limit', async () => {
    vi.useFakeTimers()
    try {
      // A real fetch's body errors once the request's signal aborts.
      fetchMock.mockImplementationOnce(async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('O'))
            init!.signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
          },
        })
        return new Response(body)
      })
      let settled = false
      const login = logIn('admin', 'secret').catch((caught: unknown) => caught).finally(() => (settled = true))
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
