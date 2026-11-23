/**
 * Names a movie's files the way media servers (Jellyfin, Plex) look for them: the movie in a folder
 * `Title (Year)`, its video file `Title (Year).ext`, and the files that belong to it, named after the
 * video (subtitles, `Title (Year).ru.srt`), keeping what follows its name. qBittorrent renames them
 * in place, so the torrent keeps seeding (docs/SPEC.md's decision log, 2026-11-23).
 *
 * The heuristic's scope: one main video file, the largest file of a video type that isn't a sample
 * ("sample" as a word in its path). A torrent with no such video, with another over a quarter of the
 * main one's size (parts of a movie, versions of it) or with a disc's folders (BDMV, VIDEO_TS) isn't
 * named, and says why. Nor is one whose movie has the word in its title while a video's path has it
 * too, where the word tells no sample apart (docs/SPEC.md's decision log, 2026-11-23). Every
 * other file (samples, extras, a release's .nfo) keeps its name and moves into the movie's folder
 * with it, where it was under the torrent's own folder.
 */

import { isUnder } from './freeUpSpace'

/** A torrent's file as qBittorrent lists it: its path under the save path, with "/" between folders. */
export interface NamedFile {
  name: string
  size: number
}

/** One file's rename, by qBittorrent's paths: what `renameFile` takes. */
export interface FileRename {
  from: string
  to: string
}

/** Why a torrent's files aren't named for a media server. */
export type NotNamedReason = 'no-video' | 'several-videos' | 'disc' | 'sample-title'

export type MediaNames =
  | {
      named: true
      /** The renames, one per file whose path changes: none when the files are named already. */
      renames: FileRename[]
      /** The torrent's folder before and after: `from` undefined for files that had none. */
      folder: { from?: string; to: string }
      /** The files whose own name changes, by their names alone (no folders), the main video first. */
      files: { from: string; to: string }[]
    }
  | { named: false; reason: NotNamedReason }

const VIDEO = new Set(['avi', 'divx', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogm', 'ts', 'webm', 'wmv'])

/** A path through a folder of a disc's structure, which a player reads as a whole: renaming a file in it breaks it. */
const DISC_FOLDER = /(^|\/)(bdmv|video_ts)\//i

/** "sample" as a word of a video's path: something always follows it there, the type at least. */
const SAMPLE = /(^|[^a-z0-9])sample[^a-z0-9]/i

/** Another video at least this part of the main one's size is a part or a version of the movie, not an extra. */
const SECOND_VIDEO_SHARE = 0.25

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A file's type, from its own name: none for a name with no dot, or with one only in front (`.mkv`). */
const extension = (path: string) => {
  const name = base(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const isVideo = (path: string) => VIDEO.has(extension(path))

/**
 * Characters media servers or the file systems a library sits on (Windows, SMB shares) don't take in
 * a name; Jellyfin's docs list `< > : " / \ | ? *`. A colon between words becomes " - ".
 */
function safeName(text: string): string {
  return (
    text
      .replace(/\s*:\s+/g, ' - ')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      // Windows drops trailing dots and spaces from a name, and a leading dot hides it on Linux.
      .replace(/^[. ]+|[. ]+$/g, '')
  )
}

/** The movie's folder and video file name, without the extension: `Title (Year)`, or the title alone without a year. */
export function movieName(title: string, year?: number): string {
  const name = safeName(title) || 'Movie'
  return year ? `${name} (${year})` : name
}

const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
const stem = (name: string) => (extension(name) ? name.slice(0, name.lastIndexOf('.')) : name)

/** The folder every file is in, when they share one: the torrent's own folder as qBittorrent lays it out. */
function rootFolder(paths: readonly string[]): string | undefined {
  const first = paths[0]?.split('/')[0]
  return first !== undefined && paths.every((path) => path.startsWith(`${first}/`)) ? first : undefined
}

/** A path below the torrent's folder, or the whole path when it has none. */
const belowRoot = (path: string, root: string | undefined) => (root !== undefined && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)


/**
 * The renames that name a movie's files for a media server, from the torrent's files as qBittorrent
 * lists them (its content layout decides whether they're in a folder), or why they aren't named.
 */
export function movieNames(files: readonly NamedFile[], title: string, year?: number): MediaNames {
  if (files.some((file) => DISC_FOLDER.test(file.name))) return { named: false, reason: 'disc' }
  const root = rootFolder(files.map((file) => file.name))
  const videos = files.filter((file) => isVideo(file.name))
  const isSample = (file: NamedFile) => SAMPLE.test(file.name)
  // A title with the word itself: a release named after it has the word too, so it tells no sample apart.
  if (SAMPLE.test(`${title} `) && videos.some(isSample)) return { named: false, reason: 'sample-title' }
  const [main, second] = videos.filter((file) => !isSample(file)).sort((a, b) => b.size - a.size)
  if (!main) return { named: false, reason: 'no-video' }
  if (second && second.size >= main.size * SECOND_VIDEO_SHARE) return { named: false, reason: 'several-videos' }

  const name = movieName(title, year)
  const mainFolder = parent(main.name)
  const mainStem = stem(base(main.name))
  const renames: FileRename[] = []
  const named: { from: string; to: string }[] = []
  for (const file of files) {
    let to: string
    if (file === main) {
      to = `${name}/${name}.${extension(file.name)}`
    } else if (!isVideo(file.name) && parent(file.name) === mainFolder && base(file.name).startsWith(`${mainStem}.`)) {
      // A file named after the video, which the media server takes as its own: subtitles, audio, its .nfo.
      to = `${name}/${name}${base(file.name).slice(mainStem.length)}`
    } else {
      to = `${name}/${belowRoot(file.name, root)}`
    }
    if (to !== file.name) renames.push({ from: file.name, to })
    if (base(to) !== base(file.name)) named.push({ from: base(file.name), to: base(to) })
  }
  return { named: true, renames, folder: { from: root, to: name }, files: named }
}

/**
 * The renames that give a torrent's files back the names its metadata has, as qBittorrent lays them
 * out by default (its "Original" content layout: a torrent of several files in a folder of its name),
 * matched by qBittorrent's file index; none when only the torrent's folder differs, as qBittorrent's
 * other layouts put it. Undefined when the metadata doesn't list the same files.
 */
export function originalNames(
  files: readonly (NamedFile & { index: number })[],
  meta: { name: string; files: readonly { path: string }[]; multiFile: boolean },
): FileRename[] | undefined {
  if (files.length !== meta.files.length) return undefined
  const root = rootFolder(files.map((file) => file.name))
  const renames: FileRename[] = []
  // Whether a name below the torrent's folder differs: qBittorrent's other content layouts put the
  // files in a folder the metadata doesn't name, or out of the one it does, and that's no rename.
  let renamed = false
  for (const file of files) {
    const original = meta.files[file.index]
    if (!original) return undefined
    const to = meta.multiFile ? `${meta.name}/${original.path}` : original.path
    if (to === file.name) continue
    renames.push({ from: file.name, to })
    if (original.path !== file.name && original.path !== belowRoot(file.name, root)) renamed = true
  }
  return renamed ? renames : []
}

/** What `folderTakenBy` reads of a torrent: qBittorrent's `torrents/info` fields. */
export interface PlacedTorrent {
  hash: string
  name: string
  save_path: string
  content_path: string
}

/**
 * Another torrent whose files are at or under the folder naming would put this one's in, in its save
 * path: naming would make the two share files, which libtorrent then writes over or refuses after
 * qBittorrent said OK (docs/SPEC.md's decision log, 2026-11-23). Letters' case doesn't count, so a
 * folder that differs only in case on a disk that ignores it (Windows, macOS) is taken too.
 */
export function folderTakenBy<T extends PlacedTorrent>(torrents: Iterable<T>, own: PlacedTorrent, folder: string): T | undefined {
  const target = `${own.save_path.replace(/[\\/]+$/, '')}/${folder}`.toLowerCase()
  for (const torrent of torrents) {
    if (torrent.hash !== own.hash && isUnder(torrent.content_path.toLowerCase(), target)) return torrent
  }
  return undefined
}
