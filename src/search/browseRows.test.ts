import { describe, expect, it } from 'vitest'
import { browseRowQueries } from './browseRows'

// Late in the evening in UTC+3 is already the next day there; dates are UTC days.
const TODAY = new Date('2026-10-28T00:30:00Z')

function query(key: string) {
  const found = browseRowQueries(TODAY).find((row) => row.key === key)
  if (!found) throw new Error(`No row ${key}`)
  return found
}

describe('browseRowQueries', () => {
  it('lists the rows in the order they show', () => {
    expect(browseRowQueries(TODAY).map((row) => [row.key, row.type])).toEqual([
      ['newOnDigital', 'movie'],
      ['newEpisodes', 'tv'],
      ['bestOfYear', 'movie'],
    ])
  })

  it('finds movies out on digital or disc in the last 60 days, in any country, most popular first', () => {
    const { params } = query('newOnDigital')
    expect(params).toMatchObject({
      with_release_type: '4|5',
      'release_date.gte': '2026-08-29',
      'release_date.lte': '2026-10-28',
      sort_by: 'popularity.desc',
      include_adult: false,
    })
    expect(params).not.toHaveProperty('region')
  })

  it('leaves out old films with a fresh disc release', () => {
    expect(query('newOnDigital').params['primary_release_date.gte']).toBe('2025-10-28')
  })

  it('finds scripted series with an episode in the last two weeks, most popular first', () => {
    expect(query('newEpisodes').params).toEqual({
      with_type: '2|4',
      'air_date.gte': '2026-10-14',
      'air_date.lte': '2026-10-28',
      sort_by: 'popularity.desc',
      include_adult: false,
    })
  })

  it('finds the best rated movies out on digital or disc this year, by enough votes', () => {
    expect(query('bestOfYear').params).toEqual({
      with_release_type: '4|5',
      'release_date.gte': '2025-10-28',
      'release_date.lte': '2026-10-28',
      'primary_release_date.gte': '2025-05-06',
      'vote_count.gte': 300,
      sort_by: 'vote_average.desc',
      include_adult: false,
    })
  })
})
