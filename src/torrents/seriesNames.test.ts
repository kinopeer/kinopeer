import { describe, expect, it } from 'vitest'
import { episodeName, episodeOf, filesTakenBy, seriesNames } from './seriesNames'

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
    expect(episodeOf('Show/S00/E01.mkv')).toEqual({ season: 0, first: 1, last: 1 })
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
    expect(named.named && named.unread).toEqual([
      `${release}/Extras/Making of.mkv`,
      `${release}/a.S01E02.mkv`,
      `${release}/a.S01E02.PROPER.mkv`,
      `${release}/a.S01E03-E04.mkv`,
      `${release}/a.S01E04.mkv`,
    ])
    expect(named.named && named.files).toEqual([{ from: 'a.S01E01.mkv', to: `Season 01/${SHOW} S01E01.mkv` }])
    expect(named.named && named.renames).toContainEqual({ from: `${release}/a.S01E02.mkv`, to: `${SHOW}/Season 01/a.S01E02.mkv` })
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
