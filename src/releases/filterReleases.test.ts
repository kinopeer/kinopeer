import { describe, expect, it } from 'vitest'
import type { Release } from '../api/prowlarr'
import {
  DEFAULT_SORT,
  NO_FILTERS,
  filterReleases,
  knownReleaseFilters,
  knownReleaseSort,
  presentValues,
  remember,
  split,
  startingFilters,
  summary,
  toggle,
  type ReleaseRow,
  type RememberedFilters,
} from './filterReleases'
import { parseRelease } from './parseRelease'

function row(id: string, title: string, size: number, seeders: number, indexer: string, publishDate?: string): ReleaseRow {
  const release: Release = { id, title, indexer, size, seeders, leechers: 0, categories: [], download: id, publishDate }
  return { release, info: parseRelease(title) }
}

const ROWS = [
  row('remux', 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HEVC-FGT', 78e9, 214, 'RuTracker', '2024-05-01T00:00:00Z'),
  row('web', 'Дюна 2 / Dune: Part Two (2024) WEB-DL 1080p | Дубляж', 9.4e9, 2451, 'Kinozal', '2024-04-01T00:00:00Z'),
  row('small', 'Dune.Part.Two.2024.720p.BluRay.x264.Sub-VARYG', 4.7e9, 12, 'Kinozal'),
]
const ids = (rows: ReleaseRow[]) => rows.map((r) => r.release.id)

describe('filterReleases', () => {
  it('sorts by seeders, most first, by default', () => {
    expect(ids(filterReleases(ROWS, NO_FILTERS, DEFAULT_SORT))).toEqual(['web', 'remux', 'small'])
  })

  it('sorts by size or date either way, undated last when newest first', () => {
    expect(ids(filterReleases(ROWS, NO_FILTERS, { key: 'size', descending: false }))).toEqual(['small', 'web', 'remux'])
    expect(ids(filterReleases(ROWS, NO_FILTERS, { key: 'date', descending: true }))).toEqual(['remux', 'web', 'small'])
  })

  it('keeps rows matching any value of a filter and every filter', () => {
    const sort = DEFAULT_SORT
    expect(ids(filterReleases(ROWS, { ...NO_FILTERS, resolution: ['2160p', '720p'] }, sort))).toEqual(['remux', 'small'])
    expect(ids(filterReleases(ROWS, { ...NO_FILTERS, resolution: ['2160p', '720p'], indexer: ['Kinozal'] }, sort))).toEqual(['small'])
    expect(ids(filterReleases(ROWS, { ...NO_FILTERS, audio: ['dub'] }, sort))).toEqual(['web'])
    expect(ids(filterReleases(ROWS, { ...NO_FILTERS, source: ['BluRay', 'REMUX'] }, sort))).toEqual(['remux', 'small'])
    expect(ids(filterReleases(ROWS, { ...NO_FILTERS, minSeeds: 100 }, sort))).toEqual(['web', 'remux'])
  })
})

describe('presentValues', () => {
  it('offers only the values the results have, in display order', () => {
    const present = presentValues(ROWS)
    expect(present.resolution).toEqual(['2160p', '1080p', '720p'])
    expect(present.audio).toEqual(['dub', 'subs'])
    expect(present.indexer).toEqual(['Kinozal', 'RuTracker'])
  })

  it('offers HDRip as a source of its own, after the WEB ones', () => {
    const rows = [...ROWS, row('hdrip', 'Дюна: Часть вторая (2024) HDRip | Многоголосый', 1.5e9, 40, 'RuTor')]
    expect(presentValues(rows).source).toEqual(['REMUX', 'BluRay', 'WEB-DL', 'HDRip'])
  })
})

describe('startingFilters', () => {
  const start = (remembered: Partial<RememberedFilters>) =>
    startingFilters({ resolution: [], audio: [], source: [], minSeeds: 0, ...remembered }, ROWS, presentValues(ROWS))

  it('keeps the remembered values the results have and drops the rest', () => {
    expect(start({ resolution: ['1080p', 'SD'], audio: ['dub', 'mvo'], source: ['WEB-DL', 'DVD'], minSeeds: 50 })).toEqual({
      resolution: ['1080p'],
      audio: ['dub'],
      source: ['WEB-DL'],
      indexer: [],
      minSeeds: 50,
    })
  })

  it('sets aside a minimum of seeds none of the releases reaches', () => {
    expect(start({ minSeeds: 5000 }).minSeeds).toBe(0)
  })

  it('lets filters that match no release together give way, the seeds first and the resolution last', () => {
    // Each pair below matches a release with either filter alone, so the order decides which stays.
    const first = (remembered: Partial<RememberedFilters>, rows: ReleaseRow[]) =>
      startingFilters({ resolution: [], audio: [], source: [], minSeeds: 0, ...remembered }, rows, presentValues(rows))
    const seedsOrSource = [row('web', 'Film.2024.1080p.WEB-DL', 1e9, 5, 'A'), row('bd', 'Film.2024.1080p.BluRay', 1e9, 100, 'A')]
    expect(first({ source: ['WEB-DL'], minSeeds: 10 }, seedsOrSource)).toMatchObject({ source: ['WEB-DL'], minSeeds: 0 })
    const sourceOrAudio = [row('web', 'Film.2024.1080p.WEB-DL', 1e9, 100, 'A'), row('dub', 'Фильм (2024) BluRay 1080p | Дубляж', 1e9, 100, 'A')]
    expect(first({ source: ['WEB-DL'], audio: ['dub'] }, sourceOrAudio)).toMatchObject({ source: [], audio: ['dub'] })
    const audioOrResolution = [row('uhd', 'Film.2024.2160p.WEB-DL', 1e9, 100, 'A'), row('dub', 'Фильм (2024) WEB-DL 1080p | Дубляж', 1e9, 100, 'A')]
    expect(first({ resolution: ['2160p'], audio: ['dub'] }, audioOrResolution)).toMatchObject({ resolution: ['2160p'], audio: [] })
  })

  it('puts back a filter that gave way when the releases still match with it', () => {
    // Only BluRay releases are dubbed: the seeds give way, then the source, and then the seeds come back.
    const rows = [
      row('web', 'Film.2024.1080p.WEB-DL.x264', 1e9, 150, 'A'),
      row('dub', 'Фильм (2024) BluRay 1080p | Дубляж', 1e9, 50, 'A'),
      row('dead', 'Фильм (2024) BluRay 720p | Дубляж', 1e9, 5, 'A'),
    ]
    const remembered: RememberedFilters = { resolution: [], audio: ['dub'], source: ['WEB-DL'], minSeeds: 10 }
    expect(startingFilters(remembered, rows, presentValues(rows))).toMatchObject({ audio: ['dub'], source: [], minSeeds: 10 })
  })
})

describe('remember', () => {
  const remembered: RememberedFilters = { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 }
  const shown = { ...NO_FILTERS, resolution: ['2160p' as const], audio: ['dub' as const] }

  it('replaces only the filters a change sets', () => {
    expect(remember(remembered, { minSeeds: 10 }, shown)).toEqual({ ...remembered, minSeeds: 10 })
  })

  it('leaves the remembered filters as they were on an indexer change', () => {
    expect(remember(remembered, { indexer: ['Kinozal'] }, shown)).toEqual(remembered)
  })

  it('keeps the values set aside in a changed filter, and forgets the ones taken off', () => {
    // SD is set aside: the search shows 1080p only.
    const usual: RememberedFilters = { ...remembered, resolution: ['SD', '1080p'] }
    const filters = { ...shown, resolution: ['1080p' as const] }
    expect(remember(usual, { resolution: ['1080p', '720p'] }, filters).resolution).toEqual(['1080p', '720p', 'SD'])
    expect(remember(usual, { resolution: [] }, filters).resolution).toEqual(['SD'])
    // The dub gave way, though some release has it: picking another audio keeps it too.
    expect(remember(remembered, { audio: ['orig'] }, { ...shown, audio: [] }).audio).toEqual(['orig', 'dub'])
  })
})

describe('split', () => {
  it('splits the remembered filters by whether the search applies them', () => {
    const remembered: RememberedFilters = { resolution: ['2160p', '1080p'], audio: ['dub'], source: [], minSeeds: 100 }
    const filters = { ...NO_FILTERS, resolution: ['1080p' as const], audio: ['dub' as const] }
    expect(split(remembered, filters)).toEqual({
      applied: { resolution: ['1080p'], audio: ['dub'], source: [], minSeeds: 0 },
      aside: { resolution: ['2160p'], audio: [], source: [], minSeeds: 100 },
    })
  })
})

describe('knownReleaseFilters', () => {
  it('keeps only the values the filters offer, a missing or malformed filter empty', () => {
    expect(knownReleaseFilters({ resolution: ['2160p'], minSeeds: 50 })).toEqual({ resolution: ['2160p'], audio: [], source: [], minSeeds: 50 })
    // Not one of the seeds options (Any, 10+, 50+, 100+), so no option could show it as picked.
    expect(knownReleaseFilters({ minSeeds: 37 }).minSeeds).toBe(0)
    expect(knownReleaseFilters({ resolution: null, audio: 'dub', source: ['WEB-DL', 'VHS', 3], minSeeds: '10' })).toEqual({
      resolution: [],
      audio: [],
      source: ['WEB-DL'],
      minSeeds: 0,
    })
    expect(knownReleaseFilters(undefined)).toEqual({ resolution: [], audio: [], source: [], minSeeds: 0 })
    expect(knownReleaseFilters('2160p')).toEqual({ resolution: [], audio: [], source: [], minSeeds: 0 })
  })
})

describe('knownReleaseSort', () => {
  it('takes a stored sort the releases have, else the default', () => {
    expect(knownReleaseSort({ key: 'date', descending: false })).toEqual({ key: 'date', descending: false })
    expect(knownReleaseSort({ key: 'peers' as never, descending: false })).toEqual(DEFAULT_SORT)
    expect(knownReleaseSort(undefined)).toEqual(DEFAULT_SORT)
    // Stored without a direction: most first, as by default.
    expect(knownReleaseSort({ key: 'size' })).toEqual({ key: 'size', descending: true })
    expect(knownReleaseSort({ key: 'size', descending: 'false' as never })).toEqual({ key: 'size', descending: true })
  })
})

describe('summary and toggle', () => {
  it('names a chip by its picks', () => {
    expect(summary([], 'Resolution')).toBe('Resolution')
    expect(summary(['1080p'], 'Resolution')).toBe('1080p')
    expect(summary(['dub', 'mvo'], 'Audio', (value) => value.toUpperCase())).toBe('DUB +1')
  })

  it('adds or removes a value', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })
})
