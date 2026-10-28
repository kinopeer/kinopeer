import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { browseRowQueries } from './browseRows'

// 20:30 on the 27th in New York, already the 28th in UTC: the dates are UTC days, not local ones.
const TODAY = new Date('2026-10-28T00:30:00Z')

beforeAll(() => {
  vi.stubEnv('TZ', 'America/New_York')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

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

  it('finds movies out on digital or disc in the last 60 days, in any country, first released within 18 months, most popular first', () => {
    expect(query('newOnDigital').params).toEqual({
      with_release_type: '4|5',
      'release_date.gte': '2026-08-29',
      'release_date.lte': '2026-10-29',
      'primary_release_date.gte': '2025-05-06',
      sort_by: 'popularity.desc',
      include_adult: false,
    })
  })

  it('finds scripted series with an episode in the last two weeks, most popular first', () => {
    expect(query('newEpisodes').params).toEqual({
      with_type: '2|4',
      'air_date.gte': '2026-10-14',
      'air_date.lte': '2026-10-29',
      sort_by: 'popularity.desc',
      include_adult: false,
    })
  })

  it('finds the best rated movies out on digital or disc in the last year, by enough votes', () => {
    expect(query('bestOfYear').params).toEqual({
      with_release_type: '4|5',
      'release_date.gte': '2025-10-28',
      'release_date.lte': '2026-10-29',
      'primary_release_date.gte': '2025-05-06',
      'vote_count.gte': 300,
      sort_by: 'vote_average.desc',
      include_adult: false,
    })
  })
})
