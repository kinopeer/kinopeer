import { describe, expect, it } from 'vitest'
import { parseRelease } from './parseRelease'
import { fitsType, searchCategories } from './searchCategories'

const fits = (title: string, categories: number[], type: 'movie' | 'tv') =>
  fitsType({ categories }, parseRelease(title), type)

describe('searchCategories', () => {
  it('adds "Other" to the type\'s category', () => {
    expect(searchCategories('movie')).toEqual([2000, 8000])
    expect(searchCategories('tv')).toEqual([5000, 8000])
  })
})

describe('fitsType', () => {
  it('keeps anything in the type\'s own category or its subcategories', () => {
    expect(fits('Dune Part Two OST', [2000], 'movie')).toBe(true)
    expect(fits('Breaking Bad S01', [5040, 100015], 'tv')).toBe(true)
  })

  it('keeps video from "Other" and drops the rest', () => {
    expect(fits('Дюна: Часть вторая / Dune: Part Two (2024) BDRemux 1080p от ExKinoRay | D', [8000], 'movie')).toBe(true)
    expect(fits('Дюна / Dune (2021) HDRip', [8000], 'movie')).toBe(true)
    expect(fits('Hans Zimmer - Dune: Part Two (Original Motion Picture Soundtrack) (2024) MP3', [8000], 'movie')).toBe(false)
    expect(fits('Фрэнк Герберт - Дюна (2024) FB2', [8000, 7000], 'movie')).toBe(false)
  })

  it('drops series from "Other" when looking for a movie', () => {
    expect(fits('Дюна: Пророчество / Dune: Prophecy [S01] (2024) WEB-DL 1080p', [8000], 'movie')).toBe(false)
    expect(fits('Во все тяжкие / Breaking Bad [S01-05] (2008) BDRip 720p', [8000], 'tv')).toBe(true)
  })

  it('drops releases from the other type\'s category', () => {
    expect(fits('Breaking Bad S01 1080p', [5000], 'movie')).toBe(false)
  })
})
