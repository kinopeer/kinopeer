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
  it('keeps the remembered values the results have and drops the rest', () => {
    const remembered: RememberedFilters = { resolution: ['2160p', 'SD'], audio: ['mvo', 'subs'], source: ['WEB-DL', 'DVD'], minSeeds: 50 }
    expect(startingFilters(remembered, ROWS)).toEqual({
      resolution: ['2160p'],
      audio: ['subs'],
      source: ['WEB-DL'],
      indexer: [],
      minSeeds: 50,
    })
  })

  it('sets aside a minimum of seeds none of the releases reaches', () => {
    expect(startingFilters({ resolution: [], audio: [], source: [], minSeeds: 5000 }, ROWS).minSeeds).toBe(0)
  })
})

describe('remember', () => {
  const remembered: RememberedFilters = { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 }

  it('replaces only the filters a change sets', () => {
    expect(remember(remembered, { minSeeds: 10 })).toEqual({ ...remembered, minSeeds: 10 })
  })

  it('leaves the remembered filters as they were on an indexer change', () => {
    expect(remember(remembered, { indexer: ['Kinozal'] })).toEqual(remembered)
  })
})

describe('knownReleaseFilters', () => {
  it('fills in a filter the stored ones lack as empty', () => {
    expect(knownReleaseFilters({ resolution: ['2160p'] })).toEqual({ resolution: ['2160p'], audio: [], source: [], minSeeds: 0 })
    expect(knownReleaseFilters(undefined)).toEqual({ resolution: [], audio: [], source: [], minSeeds: 0 })
  })
})

describe('knownReleaseSort', () => {
  it('takes a stored sort the releases have, else the default', () => {
    expect(knownReleaseSort({ key: 'date', descending: false })).toEqual({ key: 'date', descending: false })
    expect(knownReleaseSort({ key: 'peers' as never, descending: false })).toEqual(DEFAULT_SORT)
    expect(knownReleaseSort(undefined)).toEqual(DEFAULT_SORT)
    // Stored without a direction: most first, as by default.
    expect(knownReleaseSort({ key: 'size' })).toEqual({ key: 'size', descending: true })
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
