import { describe, expect, it } from 'vitest'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { PARASITE_RU } from '../test/fixtures'
import { needsEnglishTitle, releaseQueries, releaseQuery } from './releaseQuery'

describe('releaseQuery', () => {
  it('uses the original title and year for a movie', () => {
    const movie = { title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', release_date: '2024-02-27' } as MovieDetails
    expect(releaseQuery({ type: 'movie', ...movie })).toBe('Dune Part Two 2024')
  })

  it('uses only the name for a series', () => {
    const series = { name: 'Во все тяжкие', original_name: 'Breaking Bad', first_air_date: '2008-01-20' } as TvDetails
    expect(releaseQuery({ type: 'tv', ...series })).toBe('Breaking Bad')
  })

  it('falls back to the localized title', () => {
    const movie = { title: 'Brother', original_title: '', release_date: '' } as MovieDetails
    expect(releaseQuery({ type: 'movie', ...movie })).toBe('Brother')
  })
})

const parasite = PARASITE_RU
const inEnglish = (title: string) => ({ type: 'movie' as const, ...parasite, title })

describe('needsEnglishTitle', () => {
  it.each([
    ['Korean', '기생충', true],
    ['Japanese', '千と千尋の神隠し', true],
    ['Chinese', '卧虎藏龙', true],
    ['Thai', 'ฉลาดเกมส์โกง', true],
    ['Latin', 'Dune: Part Two', false],
    ['Latin with diacritics', 'Shōgun', false],
    ['Latin among other scripts', 'Gisaengchung 기생충', false],
    ['Cyrillic', 'Брат', false],
    ['no letters', '1917', false],
  ])('%s: %s', (_script, original_title, needed) => {
    expect(needsEnglishTitle({ type: 'movie', ...parasite, original_title })).toBe(needed)
  })

  it('reads a series by its original name', () => {
    const series = { name: 'Игра в кальмара', original_name: '오징어 게임' } as TvDetails
    expect(needsEnglishTitle({ type: 'tv', ...series })).toBe(true)
  })
})

describe('releaseQueries', () => {
  it('adds the English name, with the year, for an original not in Latin script', () => {
    expect(releaseQueries({ type: 'movie', ...parasite }, inEnglish('Parasite'))).toEqual(['기생충 2019', 'Parasite 2019'])
  })

  it('adds a series’ English name without a year', () => {
    const series = { name: 'Игра в кальмара', original_name: '오징어 게임', first_air_date: '2021-09-17' } as TvDetails
    const english = { type: 'tv' as const, ...series, name: 'Squid Game' }
    expect(releaseQueries({ type: 'tv', ...series }, english)).toEqual(['오징어 게임', 'Squid Game'])
  })

  it('searches by the original alone without the English details', () => {
    expect(releaseQueries({ type: 'movie', ...parasite })).toEqual(['기생충 2019'])
  })

  it('searches by the original alone when TMDB has no English name, so gives the original', () => {
    expect(releaseQueries({ type: 'movie', ...parasite }, inEnglish('기생충'))).toEqual(['기생충 2019'])
  })

  it('searches by the original alone when the English name is only punctuation', () => {
    expect(releaseQueries({ type: 'movie', ...parasite, release_date: '' }, { ...inEnglish('?!'), release_date: '' })).toEqual(['기생충'])
  })

  it('ignores English details for an original in Latin or Cyrillic script', () => {
    const brother = { title: 'Brother', original_title: 'Брат', release_date: '1997-05-17' } as MovieDetails
    expect(releaseQueries({ type: 'movie', ...brother }, { type: 'movie', ...brother, title: 'Brother' })).toEqual(['Брат 1997'])
  })
})
