import { describe, expect, it } from 'vitest'
import { GB, MB } from '../test/fixtures'
import { folderTakenBy, titleName, movieNames, originalNames } from './mediaNames'

const file = (name: string, size = 1 * MB) => ({ name, size })

describe('titleName', () => {
  it('is the title with its year', () => {
    expect(titleName('Dune: Part Two', 2024)).toBe('Dune - Part Two (2024)')
    expect(titleName('Дюна', 2021)).toBe('Дюна (2021)')
  })

  it('is the title alone when the year isn’t known', () => {
    expect(titleName('Untitled Project')).toBe('Untitled Project')
  })

  it('leaves out what media servers and file systems don’t take', () => {
    expect(titleName('What? <Why> "Who" a/b\\c|d*e', 2000)).toBe('What Why Who abcde (2000)')
    expect(titleName('Time:Code', 2000)).toBe('TimeCode (2000)')
    expect(titleName('Ends with dots...', 2000)).toBe('Ends with dots (2000)')
    expect(titleName('  Spaced   out  ', 2000)).toBe('Spaced out (2000)')
    // A leading dot hides a folder on Linux, and library scans skip hidden ones.
    expect(titleName('...And Justice for All', 1979)).toBe('And Justice for All (1979)')
  })

  it('still names a title made only of such characters', () => {
    expect(titleName('???', 2000)).toBe('Movie (2000)')
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

  it('names nothing when the largest video’s path has the word “sample”, never a smaller video in its place', () => {
    const reason = { named: false, reason: 'no-video' }
    for (const files of [
      // A movie with the word in its name: the folder's name and the file's differ, in case and order, or there's no folder.
      [file('Free Sample (2012)/Free.Sample.2012.1080p.mkv', 8 * GB), file('Free Sample (2012)/Extras/featurette.mkv', 1 * GB)],
      [file('free.sample.2012.1080p-grpa/grpa-free.sample.2012.1080p.mkv', 8 * GB)],
      [file('Free.Sample.2012.1080p.mkv', 8 * GB), file('Free.Sample.2012.1080p.srt')],
      // Two parts in a folder with the word.
      [file('Free.Sample.2012/CD1.mkv', 4 * GB), file('Free.Sample.2012/CD2.mkv', 4 * GB)],
      // With its extra outside the word: the extra isn't named the movie.
      [file('Free.Sample.2012.1080p.mkv', 8 * GB), file('Extras/featurette.mkv', 1 * GB)],
      [file('grpa-release/Free.Sample.2012.1080p.mkv', 8 * GB), file('grpa-release/Extras/featurette.mkv', 1 * GB)],
    ]) {
      // The title, in the app's language, has the word or doesn't: it changes nothing.
      expect(movieNames(files, 'Free Sample', 2012)).toEqual(reason)
      expect(movieNames(files, 'Бесплатный образец', 2012)).toEqual(reason)
    }
  })

  it('goes by size alone when no video’s path has the word, whatever the title', () => {
    const named = movieNames([file('A/movie.mkv', 8 * GB), file('A/Extras/trailer.mkv', 1 * GB)], 'Free Sample', 2012)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Free Sample (2012).mkv' }])
    expect(movieNames([file('A/CD1.mkv', 4 * GB), file('A/CD2.mkv', 4 * GB)], 'Free Sample', 2012)).toEqual({ named: false, reason: 'several-videos' })
  })

  it('doesn’t count a sample, however large, as a second video', () => {
    const named = movieNames([file('A/sample.mkv', 7 * GB), file('A/movie.mp4', 8 * GB), file('A/Extras/trailer.mkv', 1 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mp4', to: 'Arrival (2016).mp4' }])
  })

  it('doesn’t name a torrent without a video', () => {
    expect(movieNames([file('A/book.pdf', 10 * MB), file('A/cover.jpg')], 'Arrival', 2016)).toEqual({ named: false, reason: 'no-video' })
    // A packed release or a disc image beside its sample: the sample is no movie, however it's the largest video.
    expect(movieNames([file('A/Sample/sample.mkv', 100 * MB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'no-video' })
    expect(movieNames([file('A/movie.rar', 4 * GB), file('A/movie.r00', 4 * GB), file('A/Sample/movie-sample.mkv', 100 * MB)], 'Arrival', 2016)).toEqual({
      named: false,
      reason: 'no-video',
    })
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
    const named = movieNames([file('A/Sample/clip.mkv', 7 * GB), file('A/Arrival-sample.mkv', 7 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Arrival (2016).mkv' }])
    // Only the word: "Samples" and "Resample" are names of their own.
    expect(movieNames([file('A/Resample.mkv', 7 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
    expect(movieNames([file('A/Samples/clip.mkv', 7 * GB), file('A/movie.mkv', 8 * GB)], 'Arrival', 2016)).toEqual({ named: false, reason: 'several-videos' })
  })

  it('takes a sample by the word at the start of a path too, for files without a shared folder', () => {
    const named = movieNames([file('Sample/clip.mkv', 7 * GB), file('movie.mkv', 8 * GB)], 'Arrival', 2016)
    expect(named.named && named.files).toEqual([{ from: 'movie.mkv', to: 'Arrival (2016).mkv' }])
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

  it('keeps a folder named “undefined” when the files share no folder', () => {
    const named = movieNames([file('A/movie.mkv', 8 * GB), file('undefined/x.srt')], 'Arrival', 2016)
    expect(named.named && named.renames[1]).toEqual({ from: 'undefined/x.srt', to: 'Arrival (2016)/undefined/x.srt' })
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

describe('folderTakenBy', () => {
  const placed = (hash: string, save_path: string, content_path: string) => ({ hash, name: `Release ${hash}`, save_path, content_path })
  const own = placed('new', '/media/movies', '/media/movies/Arrival.2016.2160p')

  it('names the other torrent at the folder naming would use, or under it, in the same save path', () => {
    const folder = placed('folder', '/media/movies', '/media/movies/Arrival (2016)')
    expect(folderTakenBy([own, folder], own, 'Arrival (2016)')).toBe(folder)
    const file = placed('file', '/media/movies', '/media/movies/Arrival (2016)/Arrival (2016).mkv')
    expect(folderTakenBy([own, file], own, 'Arrival (2016)')).toBe(file)
  })

  it('takes a folder that differs only in case, and reads Windows’ paths and a trailing separator', () => {
    const other = placed('other', '/media/movies', '/media/movies/arrival (2016)')
    expect(folderTakenBy([other], own, 'Arrival (2016)')).toBe(other)
    const windows = { ...own, save_path: 'D:\\Movies\\' }
    const there = placed('there', 'D:\\Movies', 'D:\\Movies\\Arrival (2016)\\Arrival (2016).mkv')
    expect(folderTakenBy([there], windows, 'Arrival (2016)')).toBe(there)
    expect(folderTakenBy([other], { ...own, save_path: '/media/movies//' }, 'Arrival (2016)')).toBe(other)
  })

  it('leaves the torrent itself, another save path, a folder that only starts the same and one without metadata out', () => {
    const named = { ...own, content_path: '/media/movies/Arrival (2016)' }
    expect(folderTakenBy([named], named, 'Arrival (2016)')).toBeUndefined()
    expect(folderTakenBy([placed('a', '/media/other', '/media/other/Arrival (2016)')], own, 'Arrival (2016)')).toBeUndefined()
    expect(folderTakenBy([placed('b', '/media/movies', '/media/movies/Arrival (2016) 2')], own, 'Arrival (2016)')).toBeUndefined()
    expect(folderTakenBy([placed('c', '/media/movies', '')], own, 'Arrival (2016)')).toBeUndefined()
  })
})
