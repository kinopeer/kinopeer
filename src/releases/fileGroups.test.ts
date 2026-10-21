import { describe, expect, it } from 'vitest'
import { fileLabel, groupFiles } from './fileGroups'

describe('groupFiles', () => {
  it('groups files by their top folder in torrent order', () => {
    const files = [
      { path: 'Season 1/e01.mkv', size: 10 },
      { path: 'Season 2/e01.mkv', size: 20 },
      { path: 'Season 1/e02.mkv', size: 5 },
      { path: 'readme.txt', size: 1 },
    ]
    const groups = groupFiles(files)
    expect(groups).toEqual([
      { name: 'Season 1', files: [0, 2], size: 15 },
      { name: 'Season 2', files: [1], size: 20 },
      { name: '', files: [3], size: 1 },
    ])
    expect(fileLabel(files[2].path, groups[0])).toBe('e02.mkv')
    expect(fileLabel(files[3].path, groups[2])).toBe('readme.txt')
  })
})
