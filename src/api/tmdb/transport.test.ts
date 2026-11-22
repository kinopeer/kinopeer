import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { unreachable } from '../qbittorrent/errors'
import { SETTING_KEYS } from '../settings/webui'
import { TmdbError, TmdbKeyError } from './errors'
import { webuiTransport } from './transport'

let fetchMock: Mock<typeof fetch>

/** What the page's fake qBittorrent keeps in its store for web interfaces. */
let kept: Record<string, unknown>

/** TMDB's or the proxy's answer to the next call to either. */
let answer: () => Promise<Response>

const PROXY = 'https://tmdb.example.test/3'

/** The calls that went to TMDB or the proxy, not qBittorrent's store. */
const tmdbCalls = () => fetchMock.mock.calls.filter(([url]) => !String(url).startsWith('api/v2/'))

beforeEach(() => {
  kept = {}
  answer = async () => Response.json({ results: [] })
  fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (String(url).startsWith('api/v2/clientdata/load')) return Response.json(kept)
    return answer()
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('__WEBUI__', true)
  vi.stubGlobal('__TMDB_PROXY__', PROXY)
  vi.stubGlobal('location', new URL('http://192.168.1.20:8080/'))
})

describe('webuiTransport', () => {
  it("calls TMDB straight with the user's own v3 key as its query parameter, with no cookie or other header", async () => {
    kept[SETTING_KEYS.tmdbKey] = 'own key/1'
    await webuiTransport('/search/multi?query=dune')
    const [[url, init]] = tmdbCalls()
    expect(String(url)).toBe('https://api.themoviedb.org/3/search/multi?query=dune&api_key=own%20key%2F1')
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ accept: 'application/json' })
    expect(init?.credentials).toBeUndefined()
  })

  it('sends a v4 token as a bearer token rather than in the address', async () => {
    kept[SETTING_KEYS.tmdbKey] = 'eyJ.token'
    await webuiTransport('/movie/1')
    const [[url, init]] = tmdbCalls()
    expect(String(url)).toBe('https://api.themoviedb.org/3/movie/1')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer eyJ.token')
  })

  it("goes through Kinopeer's proxy without any key where it answers the page, with no header CORS would preflight", async () => {
    await webuiTransport('/movie/1?language=en-US')
    const [[url, init]] = tmdbCalls()
    expect(String(url)).toBe(`${PROXY}/movie/1?language=en-US`)
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ accept: 'application/json' })
  })

  it("has no key without the user's own where the proxy doesn't answer the page, and asks TMDB nothing", async () => {
    vi.stubGlobal('location', new URL('https://qbt.example.com/'))
    await expect(webuiTransport('/movie/1')).rejects.toBeInstanceOf(TmdbKeyError)
    vi.stubGlobal('location', new URL('http://192.168.1.20:8080/'))
    vi.stubGlobal('__TMDB_PROXY__', '')
    await expect(webuiTransport('/movie/1')).rejects.toBeInstanceOf(TmdbKeyError)
    expect(tmdbCalls()).toEqual([])
  })

  it('passes the signal on to TMDB', async () => {
    const controller = new AbortController()
    await webuiTransport('/movie/1', controller.signal)
    expect(tmdbCalls()[0]![1]?.signal).toBe(controller.signal)
  })

  it('reads a 401 as a key TMDB rejected, and any other refusal as TMDB’s, with how long a 429 asks to wait', async () => {
    kept[SETTING_KEYS.tmdbKey] = 'own-key'
    answer = async () => Response.json({ status_message: 'Invalid API key' }, { status: 401 })
    await expect(webuiTransport('/movie/1')).rejects.toBeInstanceOf(TmdbKeyError)

    answer = async () => Response.json({ status_message: 'Not found' }, { status: 404 })
    const notFound = await webuiTransport('/movie/1').catch((error: unknown) => error)
    expect(notFound).toBeInstanceOf(TmdbError)
    expect(notFound).not.toBeInstanceOf(TmdbKeyError)
    expect(notFound).toMatchObject({ status: 404 })

    answer = async () => Response.json({ status_message: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '10' } })
    await expect(webuiTransport('/movie/1')).rejects.toMatchObject({ status: 429, retryAfterMs: 10_000 })
  })

  it('names TMDB as who didn’t answer when nothing did, as there’s no server of Kinopeer’s in this build', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'))
    const error = await webuiTransport('/movie/1').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TypeError)
    // `qbittorrent` is the service called, TMDB for TMDB's calls.
    expect(unreachable(error)).toBe('qbittorrent')
  })
})
