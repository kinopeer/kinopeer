import { describe, expect, it } from 'vitest'
import { parseName, tmdbTag, tmdbTagFor } from './parseName'

describe('parseName', () => {
  it.each([
    ['Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.DV.TrueHD.Atmos-GRPA', { title: 'Dune Part Two', year: 2024 }],
    ['Alien.Romulus.2024.1080p.WEB-DL', { title: 'Alien Romulus', year: 2024 }],
    ['Oppenheimer (2023) [1080p] [GRPH]', { title: 'Oppenheimer', year: 2023 }],
    ['1917.2019.1080p.BluRay.x264', { title: '1917', year: 2019 }],
    ['Blade.Runner.2049.2017.2160p.UHD', { title: 'Blade Runner 2049', year: 2017 }],
    ['Air Crash Investigation_HD', { title: 'Air Crash Investigation' }],
    ['Arrival_2016_1080p.mkv', { title: 'Arrival', year: 2016 }],
    ['[GRPI] Frieren - 01 [1080p]', { title: 'Frieren - 01' }],
    ['Poor Things', { title: 'Poor Things' }],
  ])('reads a movie from %s', (name, expected) => {
    expect(parseName(name)).toEqual({ year: undefined, type: undefined, season: undefined, ...expected })
  })

  it.each([
    ['The.Bear.S03.1080p.WEB-DL.DDP5.1.H.264', { title: 'The Bear', season: 3 }],
    ['Andor.S02E04.1080p.DSNP.WEB-DL', { title: 'Andor', season: 2 }],
    ['Shogun.2024.S01.Rip', { title: 'Shogun', year: 2024, season: 1 }],
    ['Severance Season 2 Complete 1080p', { title: 'Severance', season: 2 }],
  ])('reads a series from %s', (name, expected) => {
    expect(parseName(name)).toEqual({ year: undefined, type: 'tv', ...expected })
  })

  it('takes the first title of a tracker-style name', () => {
    expect(parseName('Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 2160p | Дубляж')).toEqual({
      title: 'Дюна: Часть вторая',
      year: 2024,
      type: undefined,
      season: undefined,
    })
    expect(parseName('Медведь / The Bear / Сезон: 3 / Серии: 1-10 из 10 (2024) WEB-DL 1080p')).toMatchObject({
      title: 'Медведь',
      year: 2024,
      type: 'tv',
      season: 3,
    })
  })
})

describe('tmdbTag', () => {
  it('finds the TMDB tag Kinopeer adds', () => {
    expect(tmdbTag('kinopeer, tmdb:movie:693134')).toEqual({ type: 'movie', id: 693134 })
    expect(tmdbTag('tmdb:tv:126308')).toEqual({ type: 'tv', id: 126308 })
    expect(tmdbTag('')).toBeUndefined()
    expect(tmdbTag('tmdb:person:1')).toBeUndefined()
  })

  it('round-trips with tmdbTagFor', () => {
    expect(tmdbTagFor('movie', 438631)).toBe('tmdb:movie:438631')
    expect(tmdbTag(tmdbTagFor('tv', 1399))).toEqual({ type: 'tv', id: 1399 })
  })
})
