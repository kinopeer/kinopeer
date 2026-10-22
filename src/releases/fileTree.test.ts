import { describe, expect, it } from 'vitest'
import { buildFileTree, fileName, initiallyOpen } from './fileTree'

describe('buildFileTree', () => {
  it('keeps the folders as they are, inside the torrent’s own folder', () => {
    const top = buildFileTree([
      { path: 'Show/Season 1/e01.mkv', size: 10 },
      { path: 'Show/Season 2/e01.mkv', size: 20 },
      { path: 'Show/Season 1/e02.mkv', size: 5 },
      { path: 'Show/Season 2/Extras/making-of.mkv', size: 3 },
      { path: 'Show/info.nfo', size: 1 },
    ])
    expect(top).toMatchObject({ name: '', path: 'Show', files: [4], all: [0, 1, 2, 3, 4], size: 39 })
    expect(top.folders.map((folder) => [folder.path, folder.files, folder.size])).toEqual([
      ['Show/Season 1', [0, 2], 15],
      ['Show/Season 2', [1], 23],
    ])
    expect(top.folders[1].folders[0]).toMatchObject({ name: 'Extras', all: [3] })
    expect(initiallyOpen(top)).toEqual(new Set())
  })

  it('keeps several top folders, and one folder below the torrent’s own', () => {
    expect(
      buildFileTree([
        { path: 'Movie/movie.mkv', size: 10 },
        { path: 'Extras/trailer.mkv', size: 1 },
      ]).folders.map((folder) => folder.name),
    ).toEqual(['Extras', 'Movie'])

    const top = buildFileTree([
      { path: 'Show/Season 1/e01.mkv', size: 10 },
      { path: 'Show/Season 1/e02.mkv', size: 10 },
    ])
    expect(top.folders.map((folder) => folder.path)).toEqual(['Show/Season 1'])
    expect(initiallyOpen(top)).toEqual(new Set(['Show/Season 1']))
  })

  it('doesn’t regroup loose files', () => {
    const top = buildFileTree([
      { path: 'Show.S01E01.mkv', size: 10 },
      { path: 'Show.S02E01.mkv', size: 10 },
    ])
    expect(top.folders).toEqual([])
    expect(top.files).toEqual([0, 1])
    expect(initiallyOpen(top)).toEqual(new Set())
  })

  it('sorts folders and files by name, numbers by value', () => {
    const top = buildFileTree([
      { path: 'Season_10/s10e01.avi', size: 1 },
      { path: 'Season_07/s07e01.avi', size: 1 },
      { path: 'Season_01/s01e12.avi', size: 1 },
      { path: 'Season_01/s01e01_Pilot.avi', size: 1 },
      { path: 'Season_01/s01e02.avi', size: 1 },
    ])
    expect(top.folders.map((folder) => folder.name)).toEqual(['Season_01', 'Season_07', 'Season_10'])
    expect(top.folders[0].files).toEqual([3, 4, 2])
  })

  it('names a file without its folders', () => {
    expect(fileName('Show/Season 1/e01.mkv')).toBe('e01.mkv')
    expect(fileName('movie.mkv')).toBe('movie.mkv')
  })
})
