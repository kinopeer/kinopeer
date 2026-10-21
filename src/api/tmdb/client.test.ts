import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  TmdbError,
  TmdbKeyError,
  getMovie,
  getPopular,
  getTrending,
  posterUrl,
  searchTitles,
  tmdbLanguage,
  toTitle,
} from './client'

let fetchMock: Mock<typeof fetch>

function respond(body: unknown, status = 200, contentType = 'application/json;charset=utf-8') {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType },
    }),
  )
}

function lastUrl() {
  return String(fetchMock.mock.calls.at(-1)![0])
}

const dune = {
  media_type: 'movie',
  id: 693134,
  title: 'Dune: Part Two',
  original_title: 'Dune: Part Two',
  release_date: '2024-02-27',
  overview: 'Paul Atreides unites with Chani…',
  poster_path: '/czembW0Rk1Ke7lCJGahbOhdCuhV.jpg',
  backdrop_path: '/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',
  vote_average: 8.2,
}
const andor = {
  media_type: 'tv',
  id: 83867,
  name: 'Andor',
  original_name: 'Andor',
  first_air_date: '',
  overview: '',
  poster_path: null,
  backdrop_path: null,
  vote_average: 8.3,
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchTitles', () => {
  it('queries the proxy without credentials and keeps only movies and series', async () => {
    respond({ page: 1, total_pages: 3, total_results: 41, results: [dune, { media_type: 'person', id: 1, name: 'Zendaya' }, andor] })

    const page = await searchTitles('dune & co', { language: 'ru-RU' })

    expect(lastUrl()).toBe('/tmdb/search/multi?query=dune+%26+co&include_adult=false&language=ru-RU')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
    expect(page).toMatchObject({ page: 1, totalPages: 3 })
    expect(page.titles.map((t) => [t.type, t.title, t.year])).toEqual([
      ['movie', 'Dune: Part Two', 2024],
      ['tv', 'Andor', undefined],
    ])
  })

  it('passes the abort signal', async () => {
    respond({ page: 1, total_pages: 0, total_results: 0, results: [] })
    const controller = new AbortController()
    await searchTitles('x', { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})

describe('errors', () => {
  it('reports a rejected key', async () => {
    respond({ status_code: 7, status_message: 'Invalid API key' }, 401)
    await expect(getMovie(1)).rejects.toBeInstanceOf(TmdbKeyError)
  })

  it('reports a missing proxy route as a key problem', async () => {
    respond('Not Found', 404, 'text/plain')
    await expect(getMovie(1)).rejects.toBeInstanceOf(TmdbKeyError)
  })

  it('keeps TMDB’s own 404 as a plain error', async () => {
    respond({ status_code: 34, status_message: 'Not found' }, 404)
    const error = await getMovie(1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TmdbError)
    expect(error).not.toBeInstanceOf(TmdbKeyError)
  })
})

describe('getTrending', () => {
  it('defaults to all titles this week', async () => {
    respond({ page: 1, total_pages: 1, total_results: 1, results: [dune] })
    await getTrending()
    expect(lastUrl()).toBe('/tmdb/trending/all/week')
  })
})

describe('getPopular', () => {
  it('tags results with the requested type', async () => {
    const { media_type: _, ...tv } = andor
    respond({ page: 1, total_pages: 1, total_results: 1, results: [tv] })
    const page = await getPopular('tv', { language: 'en-US' })
    expect(lastUrl()).toBe('/tmdb/tv/popular?language=en-US')
    expect(page.titles[0]).toMatchObject({ type: 'tv', title: 'Andor' })
  })
})

describe('helpers', () => {
  it('maps series fields', () => {
    expect(toTitle({ ...andor, first_air_date: '2022-09-21' } as Parameters<typeof toTitle>[0])).toMatchObject({
      type: 'tv',
      title: 'Andor',
      originalTitle: 'Andor',
      year: 2022,
    })
  })

  it('builds same-origin image URLs', () => {
    expect(posterUrl('/abc.jpg', 'w185')).toBe('/tmdb-img/w185/abc.jpg')
    expect(posterUrl(null)).toBeUndefined()
  })

  it('maps app languages to TMDB ones', () => {
    expect(tmdbLanguage('ru')).toBe('ru-RU')
    expect(tmdbLanguage('en')).toBe('en-US')
  })
})
