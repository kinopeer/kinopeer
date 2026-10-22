import { describe, expect, it } from 'vitest'
import { fileLabel, groupFiles } from './fileGroups'

const names = (files: { path: string; size: number }[]) => groupFiles(files).map((group) => group.key)

describe('groupFiles', () => {
  it('groups files by their top folder in torrent order, loose files last', () => {
    const files = [
      { path: 'readme.txt', size: 1 },
      { path: 'Season 1/e01.mkv', size: 10 },
      { path: 'Season 2/e01.mkv', size: 20 },
      { path: 'Season 1/e02.mkv', size: 5 },
    ]
    const groups = groupFiles(files)
    expect(groups).toEqual([
      { key: 'dir:Season 1', name: 'Season 1', prefix: 'Season 1', files: [1, 3], size: 15 },
      { key: 'dir:Season 2', name: 'Season 2', prefix: 'Season 2', files: [2], size: 20 },
      { key: 'root', name: '', prefix: '', files: [0], size: 1 },
    ])
    expect(fileLabel(files[3].path, groups[0])).toBe('e02.mkv')
    expect(fileLabel(files[0].path, groups[2])).toBe('readme.txt')
  })

  it('looks below the folders every file shares', () => {
    const files = [
      { path: 'Show.S01-S02/Season 1/e01.mkv', size: 10 },
      { path: 'Show.S01-S02/Season 2/Extras/making-of.mkv', size: 20 },
      { path: 'Show.S01-S02/info.nfo', size: 1 },
    ]
    const groups = groupFiles(files)
    expect(groups.map((group) => group.name)).toEqual(['Season 1', 'Season 2', ''])
    expect(fileLabel(files[1].path, groups[1])).toBe('Extras/making-of.mkv')
    expect(fileLabel(files[2].path, groups[2])).toBe('info.nfo')
  })

  it('groups loose episodes by season', () => {
    const files = [
      { path: 'Breaking.Bad/Breaking.Bad.S01E01.mkv', size: 10 },
      { path: 'Breaking.Bad/Breaking.Bad.S02E01.mkv', size: 20 },
      { path: 'Breaking.Bad/breaking.bad.s01.e02.mkv', size: 5 },
      { path: 'Breaking.Bad/Sample.mkv', size: 1 },
    ]
    const groups = groupFiles(files)
    expect(groups).toEqual([
      { key: 'season:1', name: '', season: 1, prefix: 'Breaking.Bad', files: [0, 2], size: 15 },
      { key: 'season:2', name: '', season: 2, prefix: 'Breaking.Bad', files: [1], size: 20 },
      { key: 'root', name: '', prefix: 'Breaking.Bad', files: [3], size: 1 },
    ])
    expect(fileLabel(files[2].path, groups[0])).toBe('breaking.bad.s01.e02.mkv')
    expect(names([{ path: 'Show 3x07.avi', size: 1 }, { path: 'Show 3x08.avi', size: 1 }])).toEqual(['season:3'])
  })

  it('leaves a movie and a single file ungrouped', () => {
    expect(names([{ path: 'Dune.2160p/Dune.mkv', size: 10 }, { path: 'Dune.2160p/Dune.srt', size: 1 }])).toEqual([
      'root',
    ])
    expect(names([{ path: 'Show.S01E01.mkv', size: 10 }])).toEqual(['root'])
    expect(groupFiles([])).toEqual([])
  })
})
