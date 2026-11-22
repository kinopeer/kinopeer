import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { KEY_CHECK_TIMEOUT_MS, authorize, checkTmdbKey } from './direct'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('authorize', () => {
  it('adds a v3 key to the query, after one the call has', () => {
    expect(authorize('k&1', 'https://api.themoviedb.org/3/movie/1')).toEqual({ url: 'https://api.themoviedb.org/3/movie/1?api_key=k%261', headers: {} })
    expect(authorize('k', 'https://api.themoviedb.org/3/search/movie?query=x').url).toBe('https://api.themoviedb.org/3/search/movie?query=x&api_key=k')
  })

  it('sends a v4 token, a JWT, as a bearer token', () => {
    expect(authorize('eyJ.token', 'https://api.themoviedb.org/3/movie/1')).toEqual({
      url: 'https://api.themoviedb.org/3/movie/1',
      headers: { Authorization: 'Bearer eyJ.token' },
    })
  })
})

describe('checkTmdbKey', () => {
  it("asks TMDB's authentication call, and reads a 401 as a key it refuses", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }))
    await expect(checkTmdbKey('own-key')).resolves.toBe(true)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.themoviedb.org/3/authentication?api_key=own-key')

    fetchMock.mockResolvedValueOnce(Response.json({ success: false }, { status: 401 }))
    await expect(checkTmdbKey('own-key')).resolves.toBe(false)
  })

  it('rejects for any other answer, which says nothing about the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    await expect(checkTmdbKey('own-key')).rejects.toThrow('TMDB responded 503')
  })

  it("gives up when TMDB doesn't answer in time", async () => {
    vi.useFakeTimers()
    let settled = false
    fetchMock.mockImplementationOnce(
      (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    )
    const check = checkTmdbKey('own-key').finally(() => (settled = true))
    check.catch(() => {})
    await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(check).rejects.toMatchObject({ name: 'AbortError' })
  })
})
