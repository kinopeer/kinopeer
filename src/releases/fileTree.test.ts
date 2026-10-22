import { describe, expect, it } from 'vitest'
import { buildFileTree, fileName, initiallyOpen } from './fileTree'

describe('buildFileTree', () => {
  it('keeps the torrent’s folders as they are, in torrent order', () => {
    const top = buildFileTree([
      { path: 'Show/Season 1/e01.mkv', size: 10 },
      { path: 'Show/Season 2/e01.mkv', size: 20 },
      { path: 'Show/Season 1/e02.mkv', size: 5 },
      { path: 'Show/Season 2/Extras/making-of.mkv', size: 3 },
      { path: 'Show/info.nfo', size: 1 },
    ])
    expect(top.files).toEqual([])
    expect(top.all).toEqual([0, 1, 2, 3, 4])
    const [show] = top.folders
    expect(show).toMatchObject({ name: 'Show', path: 'Show', files: [4], size: 39 })
    expect(show.folders.map((folder) => [folder.path, folder.files, folder.size])).toEqual([
      ['Show/Season 1', [0, 2], 15],
      ['Show/Season 2', [1], 23],
    ])
    expect(show.folders[1].folders[0]).toMatchObject({ name: 'Extras', all: [3] })
    expect(initiallyOpen(top)).toEqual(new Set(['Show']))
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

  it('names a file without its folders', () => {
    expect(fileName('Show/Season 1/e01.mkv')).toBe('e01.mkv')
    expect(fileName('movie.mkv')).toBe('movie.mkv')
  })
})
