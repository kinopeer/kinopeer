import { describe, expect, it } from 'vitest'
import { title } from '../test/fixtures'
import { GUESS_VERSION, categoryType, lookupFor, pickBest, sameTitle, titleType } from './titleLookup'

const DUNE_1984 = title('movie', 841, 'Dune', 1984)
const DUNE_2021 = title('movie', 438631, 'Dune', 2021)
const DUNE_SERIES = title('tv', 90228, 'Dune: Prophecy', 2024)

describe('pickBest', () => {
  it('prefers the release year for movies', () => {
    expect(pickBest([DUNE_1984, DUNE_2021], { title: 'Dune', year: 2021 })).toBe(DUNE_2021)
    expect(pickBest([DUNE_1984, DUNE_2021], { title: 'Dune', year: 2022 })).toBe(DUNE_2021)
  })

  it('refuses a movie from another year', () => {
    expect(pickBest([DUNE_1984], { title: 'Dune', year: 2021 })).toBeNull()
  })

  it('keeps a series whose name carries a later season’s year', () => {
    expect(pickBest([DUNE_SERIES], { title: 'Dune Prophecy', year: 2026, type: 'tv' })).toBe(DUNE_SERIES)
  })

  it('takes the top result without a year, of the right type', () => {
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune', type: 'tv' })).toBe(DUNE_SERIES)
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune' })).toBe(DUNE_2021)
    expect(pickBest([], { title: 'Dune' })).toBeNull()
  })

  it('prefers a movie near the year to a series of that exact year', () => {
    const series = title('tv', 1, 'Normal People', 2025)
    const movie = title('movie', 2, 'Normal', 2026)
    expect(pickBest([series, movie], { title: 'Normal', year: 2025 })).toBe(movie)
    expect(pickBest([series, movie], { title: 'Normal', year: 2025 }, 'tv')).toBe(series)
  })

  it('falls back to the other type when the hinted one has nothing', () => {
    expect(pickBest([DUNE_2021], { title: 'Dune', year: 2021 }, 'tv')).toBe(DUNE_2021)
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune' }, 'tv')).toBe(DUNE_SERIES)
  })

  it('takes an exact name over a longer one', () => {
    const special = title('tv', 3, 'Dune: Special Report', 2018)
    const dune = { ...title('tv', 4, 'Дюна', 2000), originalTitle: 'Dune' }
    expect(pickBest([special, dune], { title: 'Dune' })).toBe(dune)
  })

  it('compares names in lower case, where ß and ss differ: Straße isn’t the exact name for Strasse', () => {
    const special = title('movie', 7, 'Strasse Nights', 2000)
    const strasse = title('movie', 8, 'Straße', 2000)
    expect(pickBest([special, strasse], { title: 'Strasse' })).toBe(special)
    expect(pickBest([special, strasse], { title: 'Straße' })).toBe(strasse)
  })

  it('takes an exact name a year off over another title of the exact year', () => {
    const woman = title('movie', 5, 'A Normal Woman', 2025)
    const normal = { ...title('movie', 6, 'Нормал', 2026), originalTitle: 'Normal' }
    expect(pickBest([normal, woman], { title: 'Normal', year: 2025 }, 'movie')).toBe(normal)
  })

  it('ranks a "<name>: Subtitle" spin-off last', () => {
    const special = title('tv', 3, 'Air Crash Investigation: Special Report', 2018)
    const mayday = { ...title('tv', 4, 'Расследования авиакатастроф', 2003), originalTitle: 'Mayday' }
    expect(pickBest([special, mayday], { title: 'Air Crash Investigation' }, 'tv')).toBe(mayday)
    expect(pickBest([special], { title: 'Air Crash Investigation' }, 'tv')).toBe(special)
  })

  it('takes a spin-off by either of its names, and only one of the name itself', () => {
    const special = { ...title('tv', 3, 'Air Crash Investigation: Special Report', 2018), originalTitle: 'Mayday Specials' }
    const other = title('tv', 4, 'Mayday: Air Disaster', 2003)
    expect(pickBest([special, other], { title: 'Air Crash Investigation' }, 'tv')).toBe(other)
  })

  it('takes a series for a name with season markers, over a movie of that name and year', () => {
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune', year: 2021, type: 'tv' })).toBe(DUNE_SERIES)
  })

  it('takes the exact year over a year off, under the same name', () => {
    const dune2020 = title('movie', 7, 'Dune', 2020)
    expect(pickBest([dune2020, DUNE_2021], { title: 'Dune', year: 2021 })).toBe(DUNE_2021)
  })

  it('takes another name a year off when nothing else fits', () => {
    const dunes = title('movie', 8, 'Dunes', 2020)
    expect(pickBest([dunes], { title: 'Dune', year: 2021 })).toBe(dunes)
  })

  it('compares names by their letters and digits, whatever stands between them', () => {
    const making = title('movie', 9, 'The Making of Dune: Part Two', 2024)
    const partTwo = title('movie', 693134, 'Dune: Part Two', 2023)
    expect(pickBest([making, partTwo], { title: 'Dune Part Two', year: 2024 })).toBe(partTwo)
    const dunes = title('movie', 8, 'Dunes', 2021)
    const dune = title('movie', 10, 'Dune!', 2021)
    expect(pickBest([dunes, dune], { title: 'Dune' })).toBe(dune)
  })
})

describe('sameTitle', () => {
  it('is the same TMDB title by type and id, and never a missing one', () => {
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'tv', id: 1 })).toBe(true)
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'movie', id: 1 })).toBe(false)
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'tv', id: 2 })).toBe(false)
    expect(sameTitle(null, null)).toBe(false)
    expect(sameTitle({ type: 'tv', id: 1 }, undefined)).toBe(false)
  })
})

describe('categoryType', () => {
  it('reads common category names', () => {
    expect(categoryType('Movies')).toBe('movie')
    expect(categoryType('Фильмы')).toBe('movie')
    expect(categoryType('Мультфильмы')).toBe('movie')
    expect(categoryType('TV Shows')).toBe('tv')
    expect(categoryType('Show')).toBe('tv')
    expect(categoryType('Movie')).toBe('movie')
    expect(categoryType('Film')).toBe('movie')
    expect(categoryType('tv')).toBe('tv')
    expect(categoryType('Сериалы')).toBe('tv')
    expect(categoryType('Music')).toBeUndefined()
    expect(categoryType('')).toBeUndefined()
  })
})

describe('lookupFor', () => {
  it('takes the user’s choice, then the tag, then a current guess, then the name', () => {
    const torrent = { name: 'Dune.2021.1080p', tags: 'tmdb:movie:438631' }
    expect(lookupFor(torrent, { type: 'tv', id: 1, source: 'user' }).key).toBe('id:tv:1')
    expect(lookupFor(torrent, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION }).key).toBe('id:movie:438631')
    const untagged = { ...torrent, tags: '' }
    expect(lookupFor(untagged, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION }).key).toBe('id:tv:2')
    expect(lookupFor(untagged, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION - 1 }).key).toBe('q::2021:dune')
    expect(lookupFor(untagged).key).toBe('q::2021:dune')
  })

  it('uses the TMDB tag before the name', () => {
    expect(lookupFor({ name: 'whatever', tags: 'tmdb:movie:438631' }).key).toBe('id:movie:438631')
    expect(lookupFor({ name: 'Dune.2021.1080p', tags: '' }).key).toBe('q::2021:dune')
  })

  it('takes a type hint from the category, but not over season markers', () => {
    expect(lookupFor({ name: 'Normal.2025.BDRemux', tags: '', category: 'Movies' })).toMatchObject({
      key: 'q:~movie:2025:normal',
      hint: 'movie',
    })
    expect(lookupFor({ name: 'Show.S01.1080p', tags: '', category: 'Movies' })).toMatchObject({ key: 'q:tv::show', hint: undefined })
  })
})

describe('titleType', () => {
  const movie = { type: 'movie', id: 438631, title: 'Dune', year: 2021, posterPath: null } as const

  it('takes the matched title’s type first', () => {
    expect(titleType({ name: 'Dune.S01.1080p', tags: '' }, undefined, movie)).toBe('movie')
  })

  it('knows the type of a chosen, tagged or guessed title before TMDB answers', () => {
    expect(titleType({ name: 'Dune.2021', tags: '' }, { type: 'tv', id: 1, source: 'user' })).toBe('tv')
    expect(titleType({ name: 'Dune.2021', tags: 'tmdb:movie:438631' })).toBe('movie')
    expect(titleType({ name: 'Dune.2021', tags: '' }, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION })).toBe('tv')
  })

  it('falls back to season markers in the name, then the category', () => {
    expect(titleType({ name: 'Andor.S02.1080p', tags: '' }, undefined, null)).toBe('tv')
    expect(titleType({ name: 'Normal.2025.BDRemux', tags: '', category: 'Movies' }, undefined, null)).toBe('movie')
    expect(titleType({ name: 'Andor.S02.1080p', tags: '', category: 'Movies' })).toBe('tv')
  })

  it('is unknown when nothing says', () => {
    expect(titleType({ name: 'Alien.Romulus.2024.1080p', tags: '' }, undefined, null)).toBeUndefined()
    expect(titleType({ name: 'Some.Program.v2', tags: '', category: 'Software' })).toBeUndefined()
  })
})
