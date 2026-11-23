/**
 * Names a movie's files the way media servers (Jellyfin, Plex) look for them: the movie in a folder
 * `Title (Year)`, its video file `Title (Year).ext`, and the files that belong to it, named after the
 * video (subtitles, `Title (Year).ru.srt`), keeping what follows its name. qBittorrent renames them
 * in place, so the torrent keeps seeding (docs/SPEC.md's decision log, 2026-11-23).
 *
 * The heuristic's scope: one main video file, the largest file of a video type that isn't a sample.
 * A torrent with no video, with another video over a quarter of the main one's size (parts of a
 * movie, versions of it) or with a disc's folders (BDMV, VIDEO_TS) isn't named, and says why. Every
 * other file (samples, extras, a release's .nfo) keeps its name and moves into the movie's folder
 * with it, where it was under the torrent's own folder.
 */

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
export type NotNamedReason = 'no-video' | 'several-videos' | 'disc'

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

/** Folders of a disc's structure, which a player reads as a whole: renaming a file in it breaks it. */
const DISC_FOLDER = /^(bdmv|video_ts)$/i

/** "sample" as a word of a folder's or a file's name. */
const SAMPLE = /(^|[^a-z0-9])sample([^a-z0-9]|$)/i

/** Another video at least this part of the main one's size is a part or a version of the movie, not an extra. */
const SECOND_VIDEO_SHARE = 0.25

const extension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const isVideo = (path: string) => VIDEO.has(extension(path))
const isSample = (path: string) => path.split('/').some((part) => SAMPLE.test(part))

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
      // Windows drops trailing dots and spaces from a name.
      .replace(/[. ]+$/, '')
      .trim()
  )
}

/** The movie's folder and video file name, without the extension: `Title (Year)`, or the title alone without a year. */
export function movieName(title: string, year?: number): string {
  const name = safeName(title) || 'Movie'
  return year ? `${name} (${year})` : name
}

const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const stem = (name: string) => (extension(name) ? name.slice(0, name.lastIndexOf('.')) : name)

/** The folder every file is in, when they share one: the torrent's own folder as qBittorrent lays it out. */
function rootFolder(files: readonly NamedFile[]): string | undefined {
  const first = files[0]?.name.split('/')
  if (!first || first.length < 2) return undefined
  return files.every((file) => file.name.startsWith(`${first[0]}/`)) ? first[0] : undefined
}

/**
 * The renames that name a movie's files for a media server, from the torrent's files as qBittorrent
 * lists them (its content layout decides whether they're in a folder), or why they aren't named.
 */
export function movieNames(files: readonly NamedFile[], title: string, year?: number): MediaNames {
  if (files.some((file) => file.name.split('/').some((part) => DISC_FOLDER.test(part)))) return { named: false, reason: 'disc' }
  const videos = files.filter((file) => isVideo(file.name) && !isSample(file.name)).sort((a, b) => b.size - a.size)
  const [main, second] = videos
  if (!main) return { named: false, reason: 'no-video' }
  if (second && second.size >= main.size * SECOND_VIDEO_SHARE) return { named: false, reason: 'several-videos' }

  const name = movieName(title, year)
  const root = rootFolder(files)
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
      to = `${name}/${root ? file.name.slice(root.length + 1) : file.name}`
    }
    if (to !== file.name) renames.push({ from: file.name, to })
    if (base(to) !== base(file.name)) named.push({ from: base(file.name), to: base(to) })
  }
  return { named: true, renames, folder: { from: root, to: name }, files: named }
}

/**
 * The renames that give a torrent's files back the names its metadata has, as qBittorrent lays them
 * out by default (its "Original" content layout: a torrent of several files in a folder of its name),
 * matched by qBittorrent's file index. Undefined when the metadata doesn't list the same files.
 */
export function originalNames(
  files: readonly (NamedFile & { index: number })[],
  meta: { name: string; files: readonly { path: string }[]; multiFile: boolean },
): FileRename[] | undefined {
  if (files.length !== meta.files.length) return undefined
  const renames: FileRename[] = []
  for (const file of files) {
    const original = meta.files[file.index]
    if (!original) return undefined
    const to = meta.multiFile ? `${meta.name}/${original.path}` : original.path
    if (to !== file.name) renames.push({ from: file.name, to })
  }
  return renames
}
