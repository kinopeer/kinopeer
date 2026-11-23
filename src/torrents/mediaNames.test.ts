import { describe, expect, it } from 'vitest'
import { GB, MB } from '../test/fixtures'
import { movieName, movieNames, originalNames } from './mediaNames'

const file = (name: string, size = 1 * MB) => ({ name, size })

describe('movieName', () => {
  it('is the title with its year', () => {
    expect(movieName('Dune: Part Two', 2024)).toBe('Dune - Part Two (2024)')
    expect(movieName('Дюна', 2021)).toBe('Дюна (2021)')
  })

  it('is the title alone when the year isn’t known', () => {
    expect(movieName('Untitled Project')).toBe('Untitled Project')
  })

  it('leaves out what media servers and file systems don’t take', () => {
    expect(movieName('What? <Why> "Who" a/b\\c|d*e', 2000)).toBe('What Why Who abcde (2000)')
    expect(movieName('Time:Code', 2000)).toBe('TimeCode (2000)')
    expect(movieName('Ends with dots...', 2000)).toBe('Ends with dots (2000)')
    expect(movieName('  Spaced   out  ', 2000)).toBe('Spaced out (2000)')
    // A leading dot hides a folder on Linux, and library scans skip hidden ones.
    expect(movieName('...And Justice for All', 1979)).toBe('And Justice for All (1979)')
  })

  it('still names a title made only of such characters', () => {
    expect(movieName('???', 2000)).toBe('Movie (2000)')
  })
})

describe('movieNames', () => {
  const release = 'Dune.Part.Two.2024.2160p.WEB-DL-GRPA'

  it('names the folder and the video, keeps what follows the video’s name on the files named after it, and moves the rest along', () => {
    const files = [
      file(`${release}/${release}.mkv`, 18 * GB),
      file(`${release}/${release}.ru.forced.srt`),
      file(`${release}/${release}.nfo`),
      file(`${release}/Sample/${release}-sample.mkv`, 140 * MB),
      file(`${release}/Featurettes/Making of.mkv`, 1 * GB),
      file(`${release}/Other.Release.srt`),
    ]
    expect(movieNames(files, 'Dune: Part Two', 2024)).toEqual({
      named: true,
      renames: [
        { from: `${release}/${release}.mkv`, to: 'Dune - Part Two (2024)/Dune - Part Two (2024).mkv' },
        { from: `${release}/${release}.ru.forced.srt`, to: 'Dune - Part Two (2024)/Dune - Part Two (2024).ru.forced.srt' },
        { from: `${release}/${release}.nfo`, to: 'Dune - Part Two (2024)/Dune - Part Two (2024).nfo' },
        { from: `${release}/Sample/${release}-sample.mkv`, to: `Dune - Part Two (2024)/Sample/${release}-sample.mkv` },
        { from: `${release}/Featurettes/Making of.mkv`, to: 'Dune - Part Two (2024)/Featurettes/Making of.mkv' },
        { from: `${release}/Other.Release.srt`, to: 'Dune - Part Two (2024)/Other.Release.srt' },
      ],
      folder: { from: release, to: 'Dune - Part Two (2024)' },
      files: [
        { from: `${release}.mkv`, to: 'Dune - Part Two (2024).mkv' },
        { from: `${release}.ru.forced.srt`, to: 'Dune - Part Two (2024).ru.forced.srt' },
        { from: `${release}.nfo`, to: 'Dune - Part Two (2024).nfo' },
      ],
    })
  })

  it('puts a single file in a folder of its own', () => {
    expect(movieNames([file('Arrival.2016.1080p.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({
      named: true,
      renames: [{ from: 'Arrival.2016.1080p.mkv', to: 'Arrival (2016)/Arrival (2016).mkv' }],
      folder: { from: undefined, to: 'Arrival (2016)' },
      files: [{ from: 'Arrival.2016.1080p.mkv', to: 'Arrival (2016).mkv' }],
    })
  })

  it('puts files that aren’t in a folder (qBittorrent’s “Don’t create subfolder”) in one', () => {
    const named = movieNames([file('Arrival.mkv', 8 * GB), file('Arrival.en.srt')], 'Arrival', 2016)
    expect(named.named && named.renames).toEqual([
      { from: 'Arrival.mkv', to: 'Arrival (2016)/Arrival (2016).mkv' },
      { from: 'Arrival.en.srt', to: 'Arrival (2016)/Arrival (2016).en.srt' },
    ])
  })

  it('brings a video from a folder inside the torrent’s up to the movie’s folder, with the files named after it', () => {
    const named = movieNames([file('Arrival/Video/Arrival.mkv', 8 * GB), file('Arrival/Video/Arrival.en.srt'), file('Arrival/Covers/front.jpg')], 'Arrival', 2016)
    expect(named.named && named.renames).toEqual([
      { from: 'Arrival/Video/Arrival.mkv', to: 'Arrival (2016)/Arrival (2016).mkv' },
      { from: 'Arrival/Video/Arrival.en.srt', to: 'Arrival (2016)/Arrival (2016).en.srt' },
      { from: 'Arrival/Covers/front.jpg', to: 'Arrival (2016)/Covers/front.jpg' },
    ])
  })

  it('renames nothing when the files are named already', () => {
    expect(movieNames([file('Arrival (2016)/Arrival (2016).mkv', 8 * GB), file('Arrival (2016)/Arrival (2016).en.srt')], 'Arrival', 2016)).toEqual({
      named: true,
      renames: [],
      folder: { from: 'Arrival (2016)', to: 'Arrival (2016)' },
      files: [],
    })
  })

  it('takes a video named after the main one as another video, not a file of the main one', () => {
    const named = movieNames([file('A/Arrival.mkv', 8 * GB), file('A/Arrival.sample.mkv', 100 * MB)], 'Arrival', 2016)
    expect(named.named && named.renames).toContainEqual({ from: 'A/Arrival.sample.mkv', to: 'Arrival (2016)/Arrival.sample.mkv' })
  })

  it('doesn’t take a file in another folder, or one whose name only starts like the video’s, for one of the video’s', () => {
    const named = movieNames(
      [file('A/Arrival.mkv', 8 * GB), file('A/Subs/Arrival.en.srt'), file('A/Arrival-commentary.srt')],
      'Arrival',
      2016,
    )
    expect(named.named && named.files).toEqual([{ from: 'Arrival.mkv', to: 'Arrival (2016).mkv' }])
  })

  it('picks the largest video that isn’t a sample, however large the sample', () => {
    const named = movieNames([file('A/sample.mkv', 9 * GB), file('A/movie.mp4', 8 * GB), file('A/Extras/trailer.mkv', 1 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mp4', to: 'Arrival (2016).mp4' }])
  })

  it('doesn’t name a torrent without a video', () => {
    expect(movieNames([file('A/book.pdf', 10 * MB), file('A/cover.jpg')], 'Arrival', 2016)).toEqual({ named: false, reason: 'no-video' })
    expect(movieNames([file('A/Sample/sample.mkv', 100 * MB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'no-video' })
  })

  it('doesn’t name a torrent with a second video over a quarter of the main one’s size: parts or versions', () => {
    expect(movieNames([file('A/CD1.avi', 700 * MB), file('A/CD2.avi', 690 * MB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
    expect(movieNames([file('A/Theatrical.mkv', 8 * GB), file('A/Extended.mkv', 2 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
    expect(movieNames([file('A/Movie.mkv', 8 * GB), file('A/Extra.mkv', 2 * GB - 1)], 'Arrival', 2016).named).toBe(true)
  })

  it('doesn’t name a disc’s structure, which a player reads as a whole', () => {
    expect(movieNames([file('A/BDMV/STREAM/00001.m2ts', 30 * GB), file('A/BDMV/index.bdmv')], 'Arrival', 2016)).toEqual({ named: false, reason: 'disc' })
    expect(movieNames([file('A/VIDEO_TS/VTS_01_1.VOB', 1 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'disc' })
  })

  it('takes the largest video whatever order qBittorrent lists the files in', () => {
    const named = movieNames([file('A/Extras/trailer.mkv', 1 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Arrival (2016).mkv' }])
  })

  it('takes a sample by the word in any folder or file name, a large one too', () => {
    const named = movieNames([file('A/Sample/clip.mkv', 9 * GB), file('A/Arrival-sample.mkv', 9 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Arrival (2016).mkv' }])
    // Only the word: "Samples" and "Resample" are names of their own.
    expect(movieNames([file('A/Resample.mkv', 9 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
    expect(movieNames([file('A/Samples/clip.mkv', 9 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
  })

  it('takes a sample by the word at the start of a path too, for files without a shared folder', () => {
    const named = movieNames([file('Sample/clip.mkv', 7 * GB), file('movie.mkv', 8 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Arrival (2016).mkv' }])
  })

  it('doesn’t take the torrent’s own folder for a sample’s, whatever words its name has', () => {
    const release = 'Free.Sample.2012.1080p'
    const named = movieNames([file(`${release}/${release}.mkv`, 8 * GB), file(`${release}/${release}-sample.mkv`, 7 * GB)], 'Free Sample', 2012)
    expect(named.named && named.files).toEqual([{ from: `${release}.mkv`, to: 'Free Sample (2012).mkv' }])
  })

  it('takes a file without a dot before its type, or with only one in front, for no video', () => {
    expect(movieNames([file('A/mkv', 8 * GB), file('A/.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'no-video' })
  })

  it('reads a disc’s folder only by its whole name, and a disc with anything else beside it as a disc', () => {
    expect(movieNames([file('A/BDMV/STREAM/00001.m2ts', 30 * GB), file('A/cover.jpg')], 'Arrival', 2016)).toEqual({ named: false, reason: 'disc' })
    expect(movieNames([file('A/BDMVRip/movie.mkv', 8 * GB)], 'Arrival', 2016).named).toBe(true)
    expect(movieNames([file('A/NoBDMV/movie.mkv', 8 * GB)], 'Arrival', 2016).named).toBe(true)
    // A disc's folder as the torrent's own, its files laid out without a folder of the release's name.
    expect(movieNames([file('BDMV/STREAM/00001.m2ts', 30 * GB), file('BDMV/index.bdmv')], 'Arrival', 2016)).toEqual({ named: false, reason: 'disc' })
  })

  it('keeps each file’s whole path when the files aren’t all in one folder', () => {
    const named = movieNames([file('A/movie.mkv', 8 * GB), file('B/cover.jpg')], 'Arrival', 2016)
    expect(named).toMatchObject({ folder: { from: undefined }, renames: [{ to: 'Arrival (2016)/Arrival (2016).mkv' }, { from: 'B/cover.jpg', to: 'Arrival (2016)/B/cover.jpg' }] })
  })

  it('reads video types in any case', () => {
    expect(movieNames([file('A/MOVIE.MKV', 8 * GB)], 'Arrival', 2016)).toMatchObject({ named: true, files: [{ to: 'Arrival (2016).mkv' }] })
  })
})

describe('originalNames', () => {
  const meta = {
    name: 'Arrival.2016.1080p',
    multiFile: true,
    files: [{ path: 'Arrival.2016.1080p.mkv' }, { path: 'Subs/en.srt' }],
  }

  it('renames each file back to its path in the metadata, under the torrent’s folder', () => {
    const files = [
      { index: 0, name: 'Arrival (2016)/Arrival (2016).mkv', size: 8 * GB },
      { index: 1, name: 'Arrival (2016)/Subs/en.srt', size: 1 * MB },
    ]
    expect(originalNames(files, meta)).toEqual([
      { from: 'Arrival (2016)/Arrival (2016).mkv', to: 'Arrival.2016.1080p/Arrival.2016.1080p.mkv' },
      { from: 'Arrival (2016)/Subs/en.srt', to: 'Arrival.2016.1080p/Subs/en.srt' },
    ])
  })

  it('matches files by qBittorrent’s index, whatever order they come in', () => {
    const files = [
      { index: 1, name: 'Arrival.2016.1080p/Subs/en.srt', size: 1 * MB },
      { index: 0, name: 'Arrival (2016)/Arrival (2016).mkv', size: 8 * GB },
    ]
    expect(originalNames(files, meta)).toEqual([{ from: 'Arrival (2016)/Arrival (2016).mkv', to: 'Arrival.2016.1080p/Arrival.2016.1080p.mkv' }])
  })

  it('takes a single file out of the folder naming put it in', () => {
    const single = { name: 'Arrival.2016.mkv', multiFile: false, files: [{ path: 'Arrival.2016.mkv' }] }
    expect(originalNames([{ index: 0, name: 'Arrival (2016)/Arrival (2016).mkv', size: 8 * GB }], single)).toEqual([
      { from: 'Arrival (2016)/Arrival (2016).mkv', to: 'Arrival.2016.mkv' },
    ])
  })

  it('renames nothing when the names are the original ones', () => {
    expect(originalNames([{ index: 0, name: 'Arrival.2016.1080p/Arrival.2016.1080p.mkv', size: 1 }, { index: 1, name: 'Arrival.2016.1080p/Subs/en.srt', size: 1 }], meta)).toEqual([])
  })

  it('renames nothing back when only the torrent’s folder differs, as qBittorrent’s content layout puts it', () => {
    // "Create subfolder": a torrent of one file in a folder of its own.
    const single = { name: 'Arrival.2016.mkv', multiFile: false, files: [{ path: 'Arrival.2016.mkv' }] }
    expect(originalNames([{ index: 0, name: 'Arrival.2016/Arrival.2016.mkv', size: 8 * GB }], single)).toEqual([])
    // "Don't create subfolder": a torrent of several files with no folder, its files in one of their own or not.
    expect(originalNames([{ index: 0, name: 'Arrival.2016.1080p.mkv', size: 8 * GB }, { index: 1, name: 'Subs/en.srt', size: 1 * MB }], meta)).toEqual([])
    const inOne = { name: 'Arrival', multiFile: true, files: [{ path: 'Video/a.mkv' }, { path: 'Video/a.srt' }] }
    expect(originalNames([{ index: 0, name: 'Video/a.mkv', size: 8 * GB }, { index: 1, name: 'Video/a.srt', size: 1 * MB }], inOne)).toEqual([])
  })

  it('says nothing when the metadata doesn’t list the same files', () => {
    expect(originalNames([{ index: 0, name: 'Arrival.mkv', size: 1 }], meta)).toBeUndefined()
    expect(originalNames([{ index: 0, name: 'a', size: 1 }, { index: 2, name: 'b', size: 1 }], meta)).toBeUndefined()
  })
})
