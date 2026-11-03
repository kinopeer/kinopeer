import { beforeEach, describe, expect, it } from 'vitest'
import { searchPage, title } from '../test/fixtures'
import {
  KEPT_SEARCHES,
  appendPage,
  firstResults,
  forgetKeptResults,
  hasMorePages,
  keepResults,
  keptResults,
  type SearchResults,
} from './searchResults'

const DUNE = title('movie', 1, 'Dune')
const DUNE_SERIES = title('tv', 1, 'Dune: Prophecy')
const ALIEN = title('movie', 2, 'Alien')

const results = (fields: Partial<SearchResults> = {}): SearchResults => ({
  titles: [DUNE],
  page: 1,
  totalPages: 1,
  totalResults: 1,
  ...fields,
})

describe('appendPage', () => {
  it('adds the next page without the titles already there, and takes its page and counts', () => {
    const first = firstResults(searchPage([DUNE], { totalPages: 3, totalResults: 50 }))
    const next = appendPage(first, searchPage([DUNE, DUNE_SERIES, ALIEN], { page: 2, totalPages: 3, totalResults: 48 }))
    // A movie and a series can share an id.
    expect(next).toEqual({ titles: [DUNE, DUNE_SERIES, ALIEN], page: 2, totalPages: 3, totalResults: 48 })
  })
})

describe('hasMorePages', () => {
  it('says whether a page is left', () => {
    expect(hasMorePages(results({ page: 1, totalPages: 2 }))).toBe(true)
    expect(hasMorePages(results({ page: 2, totalPages: 2 }))).toBe(false)
  })

  it('stops at page 500, which is as far as TMDB goes', () => {
    expect(hasMorePages(results({ page: 499, totalPages: 812 }))).toBe(true)
    expect(hasMorePages(results({ page: 500, totalPages: 812 }))).toBe(false)
  })
})

describe('kept results', () => {
  beforeEach(() => forgetKeptResults())

  it('keeps a search’s results by history entry', () => {
    const dune = results()
    keepResults('entry-1', 'dune', dune)
    expect(keptResults('entry-1', 'dune')).toBe(dune)
    // The entry now shows another search, which nothing was kept for.
    expect(keptResults('entry-1', 'alien')).toBeUndefined()
    expect(keptResults('entry-1', null)).toBeUndefined()
  })

  it('gives the entry’s own results first, else the latest kept for the same search', () => {
    const own = results()
    const older = results({ page: 2 })
    const latest = results({ page: 3 })
    keepResults('entry-1', 'dune', own)
    keepResults('entry-2', 'dune', older)
    keepResults('entry-3', 'dune', latest)
    keepResults('entry-4', 'alien', results())

    expect(keptResults('entry-1', 'dune')).toBe(own)
    // A tab picked again: the search was made under an earlier entry.
    expect(keptResults('entry-5', 'dune')).toBe(latest)
  })

  it('keeps the latest searches only, forgetting the one kept longest ago', () => {
    for (let n = 0; n < KEPT_SEARCHES; n++) keepResults(`entry-${n}`, `search-${n}`, results())
    // Kept again, so it's one of the latest.
    keepResults('entry-0', 'search-0', results({ page: 2 }))

    keepResults('entry-new', 'search-new', results())

    expect(keptResults('entry-1', 'search-1')).toBeUndefined()
    expect(keptResults('entry-0', 'search-0')).toMatchObject({ page: 2 })
    expect(keptResults('entry-2', 'search-2')).toBeDefined()
    expect(keptResults('entry-new', 'search-new')).toBeDefined()
  })
})
