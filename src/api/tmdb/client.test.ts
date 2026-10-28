import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  TmdbKeyError,
  discoverTitles,
  getMovie,
  getRecommendations,
  getSimilar,
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
  it('queries the proxy and keeps only movies and series', async () => {
    respond({ page: 1, total_pages: 3, total_results: 41, results: [dune, { media_type: 'person', id: 1, name: 'Zendaya' }, andor] })

    const page = await searchTitles('dune & co', { language: 'ru-RU' })

    expect(lastUrl()).toBe('/tmdb/search/multi?query=dune+%26+co&include_adult=false&language=ru-RU')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
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

  it('with a year, searches movies and series by their own year', async () => {
    respond({ page: 1, total_pages: 2, total_results: 21, results: [] })
    respond({ page: 1, total_pages: 1, total_results: 0, results: [] })

    const page = await searchTitles('star', { year: 2022, language: 'en-US' })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/tmdb/search/movie?query=star&include_adult=false&primary_release_year=2022&language=en-US',
      '/tmdb/search/tv?query=star&include_adult=false&first_air_date_year=2022&language=en-US',
    ])
    expect(page).toMatchObject({ page: 1, totalPages: 2 })
  })

  it('with a year, interleaves movies and series by popularity, each keeping TMDB\'s order', async () => {
    const { media_type: _movie, ...movie } = dune
    const { media_type: _tv, ...tv } = andor
    // TMDB puts the exact title first, though it's the least popular of the movies.
    respond({
      page: 1,
      total_pages: 1,
      total_results: 2,
      results: [
        { ...movie, id: 1, title: 'The Thing', popularity: 10 },
        { ...movie, id: 2, title: 'Swamp Thing', popularity: 50 },
      ],
    })
    respond({ page: 1, total_pages: 1, total_results: 1, results: [{ ...tv, id: 3, name: 'Things', popularity: 30 }] })

    const page = await searchTitles('the thing', { year: 1982 })

    expect(page.titles.map((t) => [t.type, t.title])).toEqual([
      ['tv', 'Things'],
      ['movie', 'The Thing'],
      ['movie', 'Swamp Thing'],
    ])
  })
})

describe('errors', () => {
  it('reports a missing proxy route as a key problem', async () => {
    respond('Not Found', 404, 'text/plain')
    await expect(getMovie(1)).rejects.toBeInstanceOf(TmdbKeyError)
  })

})

describe('discoverTitles', () => {
  it('passes the filters and tags results with the requested type', async () => {
    const { media_type: _, ...tv } = andor
    respond({ page: 1, total_pages: 1, total_results: 1, results: [tv] })
    const page = await discoverTitles('tv', { sort_by: 'popularity.desc', 'air_date.gte': '2026-10-14' }, { language: 'en-US' })
    expect(lastUrl()).toBe('/tmdb/discover/tv?sort_by=popularity.desc&air_date.gte=2026-10-14&language=en-US')
    expect(page.titles[0]).toMatchObject({ type: 'tv', title: 'Andor' })
  })
})

describe('related titles', () => {
  it('asks for the recommendations of a title and tags them with its type', async () => {
    respond({ page: 1, total_pages: 2, total_results: 40, results: [andor] })
    const page = await getRecommendations('tv', 83867, { language: 'ru-RU' })
    expect(lastUrl()).toBe('/tmdb/tv/83867/recommendations?language=ru-RU')
    expect(page).toMatchObject({ page: 1, totalPages: 2, titles: [{ type: 'tv', id: 83867, title: 'Andor' }] })
  })

  it('tags similar titles, which come without media_type, with the title type', async () => {
    const { media_type: _, ...movie } = dune
    respond({ page: 1, total_pages: 1, total_results: 1, results: [movie] })
    const page = await getSimilar('movie', 438631)
    expect(lastUrl()).toBe('/tmdb/movie/438631/similar')
    expect(page.titles[0]).toMatchObject({ type: 'movie', id: 693134 })
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
