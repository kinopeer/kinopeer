import { describe, expect, it } from 'vitest'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { releaseQuery } from './releaseQuery'

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
