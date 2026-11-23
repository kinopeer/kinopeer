import { describe, expect, it } from 'vitest'
import { episodeName, episodeOf, filesTakenBy, placed, seriesNames, titleNames } from './seriesNames'
import type { NamedFile } from './mediaNames'

const MB = 1024 ** 2
const file = (name: string, size = 700 * MB) => ({ name, size })
const SHOW = 'Breaking Bad (2008)'

describe('episodeOf', () => {
  it('reads S01E01 and its multi-episode forms from a video’s own name', () => {
    expect(episodeOf('Show.S01E05.1080p.WEB-DL-GRPA.mkv')).toEqual({ season: 1, first: 5, last: 5 })
    expect(episodeOf('show.s01.e05.mkv')).toEqual({ season: 1, first: 5, last: 5 })
    expect(episodeOf('Show S1E5.mkv')).toEqual({ season: 1, first: 5, last: 5 })
    expect(episodeOf('Show.S01E05E06.mkv')).toEqual({ season: 1, first: 5, last: 6 })
    expect(episodeOf('Show.S01E09E10.mkv')).toEqual({ season: 1, first: 9, last: 10 })
    expect(episodeOf('Show.S01E05-E07.mkv')).toEqual({ season: 1, first: 5, last: 7 })
    expect(episodeOf('Show.S01E05-07.mkv')).toEqual({ season: 1, first: 5, last: 7 })
    // A resolution after a dash isn't a range's end.
    expect(episodeOf('Show.S01E05-1080p.mkv')).toEqual({ season: 1, first: 5, last: 5 })
  })

  it('reads 1x01, and never a resolution for it', () => {
    expect(episodeOf('Show - 2x07 - Title.avi')).toEqual({ season: 2, first: 7, last: 7 })
    expect(episodeOf('Show.2x07-2x08.avi')).toEqual({ season: 2, first: 7, last: 8 })
    expect(episodeOf('Show.1920x1080.mkv')).toBeUndefined()
    // A range across two seasons holds one episode of each: none is read.
    expect(episodeOf('Show.2x07-3x08.avi')).toBeUndefined()
    expect(episodeOf('Show.S02E07.2x07-3x08.avi')).toBeUndefined()
  })

  it('reads an episode marker with its season from a folder, its own name or the torrent’s name', () => {
    expect(episodeOf('Show/Season 2/E05.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Show/Season.02/Ep 05.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Сериал/Сезон 3/Серия 12.mkv')).toEqual({ season: 3, first: 12, last: 12 })
    expect(episodeOf('Сериал/3 сезон/12 серия.mkv')).toEqual({ season: 3, first: 12, last: 12 })
    expect(episodeOf('Сериал/3 сезон/12-я серия.mkv')).toEqual({ season: 3, first: 12, last: 12 })
    expect(episodeOf('Сериал/Сезон 3/Серии 1-2.mkv')).toEqual({ season: 3, first: 1, last: 2 })
    expect(episodeOf('Show.S04.1080p-GRPA/Episode 3.mkv')).toEqual({ season: 4, first: 3, last: 3 })
    expect(episodeOf('Show S04 Episode 3.mkv')).toEqual({ season: 4, first: 3, last: 3 })
    expect(episodeOf('Episode 3.mkv', 'Show.S04.1080p-GRPA')).toEqual({ season: 4, first: 3, last: 3 })
    // The torrent's name counts only for a video in no folder of the torrent's: a folder names its own.
    expect(episodeOf('Show/Season 2/Show.S02E05.mkv', 'Show.Season.1.and.2.1080p')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Show/Season 2/E05.mkv', 'Show S01 S02 1080p')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Show/S00/E01.mkv')).toEqual({ season: 0, first: 1, last: 1 })
  })

  it('reads no episode or season from codec and audio tokens, or from a title’s word that looks like a marker', () => {
    expect(episodeOf('Show.S01E03.1080p.DDP5.1.E-AC3.H.264.HDR10.AAC2.0.x265-GRPA.mkv')).toEqual({ season: 1, first: 3, last: 3 })
    expect(episodeOf('Show/Season 1/Episode 3.DDP5.1.E-AC3.H.264.HDR10.AAC2.0.x265.mkv')).toEqual({ season: 1, first: 3, last: 3 })
    expect(episodeOf('Formula E 2/Season 1/Episode 3.mkv')).toEqual({ season: 1, first: 3, last: 3 })
  })

  it('takes neither end of a season range for a season', () => {
    expect(episodeOf('Show.S01-S03.1080p/Season 2/E05.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Show.S01-03/Season 2/E05.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Сериал. Сезон 1-3/2 сезон/Серия 5.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Сериал 1-3 сезон/Сезон 2/Серия 5.mkv')).toEqual({ season: 2, first: 5, last: 5 })
    expect(episodeOf('Show.S01-S03.1080p/E05.mkv')).toBeUndefined()
  })

  it('reads nothing in doubt', () => {
    // The folder's season and the name's differ.
    expect(episodeOf('Show/Season 1/Show.S02E05.mkv')).toBeUndefined()
    expect(episodeOf('Show.S01/Season 2/E05.mkv')).toBeUndefined()
    expect(episodeOf('Show.S02E05.mkv', 'Show.S01.1080p')).toBeUndefined()
    // Two episodes in one name, or two markers that differ.
    expect(episodeOf('Show.S01E05.S01E09.mkv')).toBeUndefined()
    expect(episodeOf('Show.S01E05.1x09.mkv')).toBeUndefined()
    expect(episodeOf('Season 1/E05 E06.mkv')).toBeUndefined()
    // …that differ in one number only, the season, the first episode or the last.
    expect(episodeOf('Show.1x05.2x05.mkv')).toBeUndefined()
    expect(episodeOf('Show.S01E05-E07.S01E06-E07.mkv')).toBeUndefined()
    expect(episodeOf('Show.S01E05.S01E05-E06.mkv')).toBeUndefined()
    expect(episodeOf('Season 1/Серии 4-5 E05.mkv')).toBeUndefined()
    expect(episodeOf('Season 1/Серии 5-6 E05.mkv')).toBeUndefined()
    // …the second of them a range that runs back, or a marker beside two episodes that differ.
    expect(episodeOf('Show.S01E05.S01E07-03.mkv')).toBeUndefined()
    expect(episodeOf('Season 1/E05 Серии 7-3.mkv')).toBeUndefined()
    expect(episodeOf('Show S01E05 S01E09 - Episode 5.mkv')).toBeUndefined()
    // A marker without a season, a bare number, a range that runs back.
    expect(episodeOf('Show/E05.mkv')).toBeUndefined()
    expect(episodeOf('Show/Season 1/05.mkv')).toBeUndefined()
    expect(episodeOf('Show.S01E05-03.mkv')).toBeUndefined()
    expect(episodeOf('Season 1/Серии 5-3.mkv')).toBeUndefined()
    // Two seasons in the folders.
    expect(episodeOf('Season 1/Season 2/E05.mkv')).toBeUndefined()
    // A word that only starts like a marker.
    expect(episodeOf('Season 1/Epic 05.mkv')).toBeUndefined()
  })
})

describe('episodeName', () => {
  it('pads the numbers and names a file of several episodes by its first and last', () => {
    expect(episodeName({ season: 1, first: 5, last: 5 })).toBe('S01E05')
    expect(episodeName({ season: 0, first: 1, last: 2 })).toBe('S00E01-E02')
    expect(episodeName({ season: 12, first: 101, last: 101 })).toBe('S12E101')
  })
})

describe('seriesNames', () => {
  const release = 'Breaking.Bad.S01.1080p.BluRay-GRPA'

  it('names a season’s episodes and the files named after them, and keeps the rest in the season’s folder', () => {
    const files = [
      file(`${release}/${release.replace('S01', 'S01E01')}.mkv`),
      file(`${release}/${release.replace('S01', 'S01E01')}.rus.srt`, 1),
      file(`${release}/${release.replace('S01', 'S01E02')}.mkv`),
      file(`${release}/Sample/sample.mkv`, 50 * MB),
      file(`${release}/info.nfo`, 1),
    ]
    expect(seriesNames(files, 'Breaking Bad', 2008)).toEqual({
      named: true,
      renames: [
        { from: files[0].name, to: `${SHOW}/Season 01/${SHOW} S01E01.mkv` },
        { from: files[1].name, to: `${SHOW}/Season 01/${SHOW} S01E01.rus.srt` },
        { from: files[2].name, to: `${SHOW}/Season 01/${SHOW} S01E02.mkv` },
        { from: files[3].name, to: `${SHOW}/Season 01/Sample/sample.mkv` },
        { from: files[4].name, to: `${SHOW}/Season 01/info.nfo` },
      ],
      folder: { from: release, to: SHOW },
      files: [
        { from: 'Breaking.Bad.S01E01.1080p.BluRay-GRPA.mkv', to: `Season 01/${SHOW} S01E01.mkv` },
        { from: 'Breaking.Bad.S01E01.1080p.BluRay-GRPA.rus.srt', to: `Season 01/${SHOW} S01E01.rus.srt` },
        { from: 'Breaking.Bad.S01E02.1080p.BluRay-GRPA.mkv', to: `Season 01/${SHOW} S01E02.mkv` },
      ],
      unread: [],
    })
  })

  it('names a show whose title is made only of what a name can’t take “Show”', () => {
    expect(seriesNames([file('a.S01E01.mkv')], '???', 2008)).toMatchObject({ folder: { to: 'Show (2008)' } })
  })

  it('names nothing again once named', () => {
    const named = seriesNames([file(`${release}/a.S01E01.mkv`), file(`${release}/a.S01E01.en.srt`, 1), file(`${release}/notes.txt`, 1)], 'Breaking Bad', 2008)
    const again = seriesNames(
      (named.named ? named.renames : []).map((rename) => file(rename.to)),
      'Breaking Bad',
      2008,
    )
    expect(again).toEqual({ named: true, renames: [], folder: { from: SHOW, to: SHOW }, files: [], unread: [] })
  })

  it('keeps a pack’s other files with the show, its season folders made naming’s own', () => {
    const pack = 'Breaking.Bad.S01-S02.1080p-GRPA'
    const named = seriesNames(
      [file(`${pack}/Season 1/E01.mkv`), file(`${pack}/Season 1/cover.jpg`, 1), file(`${pack}/S02/E01.mkv`), file(`${pack}/readme.txt`, 1)],
      'Breaking Bad',
      2008,
    )
    expect(named.named && named.renames.map((rename) => rename.to)).toEqual([
      `${SHOW}/Season 01/${SHOW} S01E01.mkv`,
      `${SHOW}/Season 01/cover.jpg`,
      `${SHOW}/Season 02/${SHOW} S02E01.mkv`,
      `${SHOW}/readme.txt`,
    ])
  })

  it('makes a pack’s own season folder naming’s in each of its forms, and only a folder that is one whole', () => {
    const pack = 'Breaking.Bad.Complete-GRPA'
    const seasons = ['Season1', '3сезон', '12 сезон', 'S13']
    const named = seriesNames(
      [
        ...seasons.flatMap((folder) => [file(`${pack}/${folder}/E01.mkv`), file(`${pack}/${folder}/cover.jpg`, 1)]),
        file(`${pack}/S01 Extras/poster.jpg`, 1),
        file(`${pack}/Bonus.S02/poster.jpg`, 1),
      ],
      'Breaking Bad',
      2008,
    )
    expect(named.named && named.renames.filter((rename) => !rename.to.endsWith('.mkv')).map((rename) => rename.to)).toEqual([
      `${SHOW}/Season 01/cover.jpg`,
      `${SHOW}/Season 03/cover.jpg`,
      `${SHOW}/Season 12/cover.jpg`,
      `${SHOW}/Season 13/cover.jpg`,
      `${SHOW}/S01 Extras/poster.jpg`,
      `${SHOW}/Bonus.S02/poster.jpg`,
    ])
  })

  it('lists the videos whose episode it can’t read, and two videos of one episode, keeping their names', () => {
    const named = seriesNames(
      [
        file(`${release}/a.S01E01.mkv`),
        file(`${release}/a.S01E02.mkv`),
        file(`${release}/a.S01E02.PROPER.mkv`),
        file(`${release}/a.S01E03-E04.mkv`),
        file(`${release}/a.S01E04.mkv`),
        file(`${release}/Extras/Making of.mkv`),
      ],
      'Breaking Bad',
      2008,
    )
    // Listed below the torrent's folder, as the episodes are.
    expect(named.named && named.unread).toEqual(['Extras/Making of.mkv', 'a.S01E02.mkv', 'a.S01E02.PROPER.mkv', 'a.S01E03-E04.mkv', 'a.S01E04.mkv'])
    expect(named.named && named.files).toEqual([{ from: 'a.S01E01.mkv', to: `Season 01/${SHOW} S01E01.mkv` }])
    expect(named.named && named.renames).toContainEqual({ from: `${release}/a.S01E02.mkv`, to: `${SHOW}/Season 01/a.S01E02.mkv` })
  })

  it('puts the TMDB id on the show’s folder alone, not on its episodes', () => {
    const pack = 'Breaking.Bad.S01.1080p-GRPA'
    const folder = `${SHOW} {tmdb-1396}`
    const named = seriesNames([file(`${pack}/Breaking.Bad.S01E01.mkv`), file(`${pack}/Breaking.Bad.S01E01.en.srt`, 1), file(`${pack}/notes.nfo`, 1)], 'Breaking Bad', 2008, undefined, 1396)
    expect(named).toEqual({
      named: true,
      renames: [
        { from: `${pack}/Breaking.Bad.S01E01.mkv`, to: `${folder}/Season 01/${SHOW} S01E01.mkv` },
        { from: `${pack}/Breaking.Bad.S01E01.en.srt`, to: `${folder}/Season 01/${SHOW} S01E01.en.srt` },
        { from: `${pack}/notes.nfo`, to: `${folder}/Season 01/notes.nfo` },
      ],
      folder: { from: pack, to: folder },
      files: [
        { from: 'Breaking.Bad.S01E01.mkv', to: `Season 01/${SHOW} S01E01.mkv` },
        { from: 'Breaking.Bad.S01E01.en.srt', to: `Season 01/${SHOW} S01E01.en.srt` },
      ],
      unread: [],
    })
    // A torrent in the show's folder with the id is in it: naming it again renames nothing.
    const again = seriesNames(named.named ? named.renames.map((rename) => file(rename.to)) : [], 'Breaking Bad', 2008, undefined, 1396)
    expect(again.named && again.renames).toEqual([])
    // One named without it, half in the folder with it, is split.
    expect(seriesNames([file(`${folder}/Season 01/${SHOW} S01E01.mkv`), file(`${SHOW}/Season 01/notes.nfo`, 1)], 'Breaking Bad', 2008, undefined, 1396)).toEqual({ named: false, reason: 'split' })
  })

  it('refuses a torrent half in the show’s folder with or without the TMDB id, whichever way the switch is', () => {
    const pack = 'Breaking.Bad.S01.1080p-GRPA'
    const folder = `${SHOW} {tmdb-1396}`
    const naming = (files: NamedFile[], tmdbId?: number) => seriesNames(files, 'Breaking Bad', 2008, undefined, tmdbId)
    // Named without the id until a rename stopped, then the switch turned on.
    const before = [file(`${SHOW}/Season 01/${SHOW} S01E01.mkv`), file(`${SHOW}/Season 01/notes.nfo`, 1), file(`${pack}/Breaking.Bad.S01E02.mkv`)]
    expect(naming(before, 1396)).toEqual({ named: false, reason: 'split' })
    // Named with it until a rename stopped, then the switch turned off.
    const after = [file(`${folder}/Season 01/${SHOW} S01E01.mkv`), file(`${folder}/Season 01/notes.nfo`, 1), file(`${pack}/Breaking.Bad.S01E02.mkv`)]
    expect(naming(after)).toEqual({ named: false, reason: 'split' })
    // Half in each of the two folders, either way.
    const both = [file(`${SHOW}/Season 01/${SHOW} S01E01.mkv`), file(`${folder}/Season 01/${SHOW} S01E02.mkv`)]
    expect(naming(both, 1396)).toEqual({ named: false, reason: 'split' })
    expect(naming(both)).toEqual({ named: false, reason: 'split' })
  })

  it('renames a whole torrent from the show’s folder without the TMDB id into the one with it, and back', () => {
    const folder = `${SHOW} {tmdb-1396}`
    const naming = (files: NamedFile[], tmdbId?: number) => seriesNames(files, 'Breaking Bad', 2008, undefined, tmdbId)
    const plain = [file(`${SHOW}/Season 01/${SHOW} S01E01.mkv`), file(`${SHOW}/Season 01/notes.nfo`, 1)]
    const on = naming(plain, 1396)
    expect(on.named && on.renames).toEqual([
      { from: `${SHOW}/Season 01/${SHOW} S01E01.mkv`, to: `${folder}/Season 01/${SHOW} S01E01.mkv` },
      { from: `${SHOW}/Season 01/notes.nfo`, to: `${folder}/Season 01/notes.nfo` },
    ])
    const withId = [file(`${folder}/Season 01/${SHOW} S01E01.mkv`), file(`${folder}/Season 01/notes.nfo`, 1)]
    const off = naming(withId)
    expect(off.named && off.renames).toEqual([
      { from: `${folder}/Season 01/${SHOW} S01E01.mkv`, to: `${SHOW}/Season 01/${SHOW} S01E01.mkv` },
      { from: `${folder}/Season 01/notes.nfo`, to: `${SHOW}/Season 01/notes.nfo` },
    ])
  })

  it('names the files of a pack by their paths below its folder, which tell seasons apart', () => {
    const pack = 'Breaking.Bad.S01-S02.1080p-GRPA'
    const named = seriesNames([file(`${pack}/Season 1/Episode 1.mkv`), file(`${pack}/Season 2/Episode 1.mkv`)], 'Breaking Bad', 2008)
    expect(named.named && named.files).toEqual([
      { from: 'Season 1/Episode 1.mkv', to: `Season 01/${SHOW} S01E01.mkv` },
      { from: 'Season 2/Episode 1.mkv', to: `Season 02/${SHOW} S02E01.mkv` },
    ])
  })

  it('names nothing when naming would put two files in one place, in any case', () => {
    const pack = 'Pack.S01'
    // A file of the torrent's folder and one of its season folder of the same name.
    const files = [file(`${pack}/Season 1/E01.mkv`), file(`${pack}/Season 1/poster.jpg`, 1), file(`${pack}/poster.JPG`, 1)]
    expect(seriesNames(files, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'same-place' })
    // Two files whose names differ only in case, on a disk that tells them apart.
    const cased = [file(`${SHOW}/Season 01/E01.mkv`), file(`${SHOW}/Season 01/poster.jpg`, 1), file(`${SHOW}/Season 01/Poster.JPG`, 1)]
    expect(seriesNames(cased, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'same-place' })
    // A file that would stay where it is, where another one would go.
    const staying = [file(`${SHOW}/Season 01/E01.mkv`), file(`${SHOW}/Season 01/poster.jpg`, 1), file(`${SHOW}/poster.jpg`, 1)]
    expect(seriesNames(staying, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'same-place' })
  })

  it('names nothing when a file would go where another one is now, even one naming moves', () => {
    // Season 1/E01.srt would go to Season 01/E01.srt, which naming frees only by renaming that file
    // after it: qBittorrent refuses a rename onto a file that's there.
    const files = [
      file(`${SHOW}/Season 1/E01.srt`, 1),
      file(`${SHOW}/Season 01/E01.mkv`),
      file(`${SHOW}/Season 01/E01.srt`, 1),
      file(`${SHOW}/Season 02/E01.mkv`),
    ]
    expect(seriesNames(files, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'same-place' })
    // In any case.
    const cased = [file(`${SHOW}/Season 1/e01.SRT`, 1), ...files.slice(1)]
    expect(seriesNames(cased, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'same-place' })
    // A file renamed only in its letters' case is no other file's place.
    const own = seriesNames([file(`${SHOW}/season 01/${SHOW} S01E01.mkv`)], 'Breaking Bad', 2008)
    expect(own.named && own.renames).toEqual([{ from: `${SHOW}/season 01/${SHOW} S01E01.mkv`, to: `${SHOW}/Season 01/${SHOW} S01E01.mkv` }])
  })

  it('names nothing for a torrent with some of its files in the show’s folder and some not', () => {
    // As a rename that stopped partway leaves them: naming them again would nest the show's folder.
    const partway = [file(`${SHOW}/Season 01/${SHOW} S01E01.mkv`), file('Pack.S01/notes.nfo', 1)]
    expect(seriesNames(partway, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'split' })
    const cased = [file(`${SHOW.toUpperCase()}/Season 01/${SHOW} S01E01.mkv`), file('Pack.S01/notes.nfo', 1)]
    expect(seriesNames(cased, 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'split' })
    // A file named as the show's folder, in no folder, isn't in it.
    const beside = seriesNames([file(`${SHOW}`, 1), file('Pack.S01/E01.mkv')], 'Breaking Bad', 2008)
    expect(beside.named).toBe(true)
    // Files all in the show's folder, or all in another, are named.
    expect(seriesNames([file(`${SHOW}/Season 01/${SHOW} S01E01.mkv`), file(`${SHOW}/notes.nfo`, 1)], 'Breaking Bad', 2008).named).toBe(true)
    expect(seriesNames([file('Pack.S01/E01.mkv'), file('Pack.S01/notes.nfo', 1)], 'Breaking Bad', 2008).named).toBe(true)
    // So are files in no folder, which qBittorrent's "Don't create subfolder" layout gives.
    expect(seriesNames([file('Season 1/E01.mkv'), file('notes.nfo', 1)], 'Breaking Bad', 2008).named).toBe(true)
  })

  it('names an episode qBittorrent put in no folder, by the torrent’s name, and a single episode', () => {
    expect(seriesNames([file('Episode 3.mkv')], 'Breaking Bad', 2008, 'Breaking.Bad.S04.1080p-GRPA')).toEqual({
      named: true,
      renames: [{ from: 'Episode 3.mkv', to: `${SHOW}/Season 04/${SHOW} S04E03.mkv` }],
      folder: { from: undefined, to: SHOW },
      files: [{ from: 'Episode 3.mkv', to: `Season 04/${SHOW} S04E03.mkv` }],
      unread: [],
    })
  })

  it('takes a file named after an episode only in its folder, and a video never as one', () => {
    const named = seriesNames(
      [file(`${release}/a.S01E01.mkv`), file(`${release}/Subs/a.S01E01.srt`, 1), file(`${release}/a.S01E01-commentary.srt`, 1), file(`${release}/a.S01E01.sample.mkv`, 50 * MB)],
      'Breaking Bad',
      2008,
    )
    expect(named.named && named.files).toEqual([{ from: 'a.S01E01.mkv', to: `Season 01/${SHOW} S01E01.mkv` }])
  })

  it('names nothing without a video, without an episode, or for a disc', () => {
    expect(seriesNames([file('A/info.nfo')], 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'no-video' })
    expect(seriesNames([file('A/01.mkv'), file('A/02.mkv')], 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'no-episodes' })
    expect(seriesNames([file('A/Sample/a.S01E01.mkv')], 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'no-episodes' })
    expect(seriesNames([file('A/S01/BDMV/STREAM/00001.m2ts')], 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'disc' })
    expect(seriesNames([file('A/S01/BDMV/STREAM/00001.m2ts'), file('A/S01E02.mkv'), file('A/info.nfo', 1)], 'Breaking Bad', 2008)).toEqual({ named: false, reason: 'disc' })
  })
})

describe('placed', () => {
  it('puts a file under its torrent’s save path, with "/" between folders', () => {
    expect(placed('/tv', 'Show/a.mkv')).toBe('/tv/Show/a.mkv')
    expect(placed('/tv//', 'a.mkv')).toBe('/tv/a.mkv')
    expect(placed('D:\\TV\\', 'Show/a.mkv')).toBe('D:/TV/Show/a.mkv')
  })

  it('lines up the files of torrents saved apart, so another one in the show’s folder is found', () => {
    const ours = [`${SHOW}/Season 02/${SHOW} S02E01.mkv`].map((path) => placed('/tv', path))
    const theirs = [`${SHOW} S02E01.mkv`].map((path) => placed(`/tv/${SHOW}/Season 02`, path))
    expect(filesTakenBy(ours, [{ torrent: 'a', files: theirs }])).toBe('a')
  })
})

describe('filesTakenBy', () => {
  const ours = [`${SHOW}/Season 02/${SHOW} S02E01.mkv`, `${SHOW}/Season 02/info.nfo`]

  it('finds another torrent with a file where naming would put one, in any case', () => {
    expect(filesTakenBy(ours, [{ torrent: 'a', files: [`${SHOW}/Season 01/${SHOW} S01E01.mkv`] }, { torrent: 'b', files: [`${SHOW.toUpperCase()}/SEASON 02/INFO.NFO`] }])).toBe('b')
    expect(filesTakenBy(ours, [{ torrent: 'a', files: [`${SHOW}/Season 01/${SHOW} S01E01.mkv`, `${SHOW}/Season 02/info.nfo`] }])).toBe('a')
  })

  it('finds a file where naming needs a folder, and a folder where it puts a file', () => {
    expect(filesTakenBy(ours, [{ torrent: 'a', files: [`${SHOW}/Season 02`] }])).toBe('a')
    expect(filesTakenBy(ours, [{ torrent: 'a', files: [`${SHOW}/Season 02/info.nfo/x.txt`] }])).toBe('a')
  })

  it('takes a torrent whose files couldn’t be read as one in the way, and lets the other seasons be', () => {
    expect(filesTakenBy(ours, [{ torrent: 'a', files: undefined }])).toBe('a')
    expect(filesTakenBy(ours, [{ torrent: 'a', files: [`${SHOW}/Season 01/${SHOW} S01E01.mkv`, `${SHOW}/Season 01/info.nfo`] }])).toBeUndefined()
    expect(filesTakenBy(ours, [])).toBeUndefined()
  })
})

describe('titleNames', () => {
  const files = [file('Show.S01E01.mkv')]

  it('names a movie or a series by its type, with the TMDB id when given one', () => {
    const movie = titleNames({ type: 'movie', title: 'Arrival', year: 2016, tmdbId: 329865 }, [file('Arrival.2016.mkv')])
    expect(movie.named && movie.folder.to).toBe('Arrival (2016) {tmdb-329865}')
    const series = titleNames({ type: 'tv', title: 'Breaking Bad', year: 2008, tmdbId: 1396 }, files)
    expect(series.named && series.renames).toEqual([{ from: 'Show.S01E01.mkv', to: `${SHOW} {tmdb-1396}/Season 01/${SHOW} S01E01.mkv` }])
    const plain = titleNames({ type: 'tv', title: 'Breaking Bad', year: 2008 }, files)
    expect(plain.named && plain.folder.to).toBe(SHOW)
  })
})
