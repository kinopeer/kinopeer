/**
 * Names a series' episode files the way media servers look for them (Jellyfin's shows page): the
 * show in a folder `Show (Year)`, each season in `Season 01` (`Season 00` for specials), each episode
 * `Show (Year) S01E01.ext`, `S01E01-E02` for a file of several, and the files named after an episode
 * (subtitles, audio) with what follows its name. qBittorrent renames them in place, as for movies
 * (`mediaNames.ts`, docs/SPEC.md's decision log, 2026-11-23).
 *
 * The heuristic's scope, where it says nothing rather than guess: an episode is read from a video's
 * own name (`S01E01`, `S01E01E02`, `S01E01-E02`, `S01E01-02`, `1x01`), or from an episode marker
 * (`E01`, `Ep 01`, `Episode 1`, `Серия 1`, `1 серия`) with the season from its folders, its name or
 * the torrent's name for a video in no folder of the torrent's (`Season 1`, `Сезон 1`, `1 сезон`,
 * `S01`), each of them naming one season. A video whose seasons disagree, whose name reads two
 * different episodes or a range across two seasons, that reads none, or that reads the same episode
 * as another video, keeps its name, and the preview lists it; so does a sample ("sample" as a word in
 * its path), which isn't listed. Nothing is named when naming would put two files in one place or a
 * file where another one is now, or when some of the torrent's files are in the show's folder and
 * some not (a rename that stopped partway). The patterns follow Sonarr's parser
 * (`src/NzbDrone.Core/Parser/Parser.cs`, GPL-3.0, as Kinopeer is), narrowed to these forms.
 */

import {
  DISC_FOLDER,
  SAMPLE,
  base,
  belowRoot,
  extension,
  isVideo,
  movieNames,
  parent,
  rootFolder,
  stem,
  titleName,
  type FileRename,
  type MediaNames,
  type NamedFile,
} from './mediaNames'

/** A video's episode, or the episodes one file holds, in one season. */
export interface Episode {
  season: number
  first: number
  last: number
}

const EDGE = '(?<![\\p{L}\\p{N}])'
const END = '(?![\\p{L}\\p{N}])'

// S01E01, S01.E01, S01E01E02, S01E01-E02, S01E01-02: Sonarr's "Multi-episode with single episode
// numbers" and "Episodes with a title, Single episodes (S01E05)" forms.
const SXXEYY = new RegExp(`${EDGE}s(\\d{1,2})[ ._]?e(\\d{1,3})((?:[-–]?e\\d{1,3})*)(?:[-–](\\d{1,3})${END})?(?!\\p{N})`, 'giu')
// 1x01, 1x01-1x02: Sonarr's "Single episodes with x".
const NXNN = new RegExp(`${EDGE}(\\d{1,2})x(\\d{2,3})(?:[-–_](\\d{1,2})x(\\d{2,3}))?${END}`, 'giu')
// An episode without its season: E01, Ep 01, Episode 1, Серия 1, Серии 1-2, 1 серия.
const EPISODE = new RegExp(
  `${EDGE}(?:(?:e|ep|episode|серия|серии)[ ._]?(\\d{1,3})(?:[-–](\\d{1,3}))?|(\\d{1,3})[ ._-]?(?:я[ ._-]?)?серия)${END}`,
  'giu',
)
// A season on its own: Season 1, Season.01, Сезон 1, 1 сезон, S01; neither end of a range (S01-S03,
// S01-03, Сезон 1-3, 1-3 сезон), which names several.
const RANGE_AFTER = '(?!\\s*[-–]\\s*s?\\d)'
const RANGE_BEFORE = '(?<!\\d\\s*[-–]\\s*s?)'
const SEASON = new RegExp(
  `${EDGE}${RANGE_BEFORE}(?:(?:season|сезон)[ ._-]*(\\d{1,2})(?!\\p{N})${RANGE_AFTER}|(\\d{1,2})[ ._-]*сезон|s(\\d{1,2})(?!\\p{N})${RANGE_AFTER})`,
  'giu',
)

/** A folder that is a season's alone, as the torrent or naming names it: `Season 1`, `Season 01`, `Сезон 1`, `1 сезон`, `S01`. */
const SEASON_FOLDER = /^(?:(?:season|сезон)[ ._-]*(\d{1,2})|(\d{1,2})[ ._-]*сезон|s(\d{1,2}))$/iu

/** The one value all of them have, or undefined when there's none or they differ. */
function single(values: readonly number[]): number | undefined {
  return values.length && values.every((value) => value === values[0]) ? values[0] : undefined
}

const span = (season: number, first: number, last = first): Episode | undefined =>
  last >= first ? { season, first, last } : undefined

/** The episode a file's own name reads with its season: undefined when it reads none or two that differ. */
function namedEpisode(name: string): Episode | undefined | null {
  const found: (Episode | undefined)[] = []
  for (const match of name.matchAll(SXXEYY)) {
    const more = [...match[3].matchAll(/\d+/g)].map((digits) => Number(digits[0]))
    const last = match[4] !== undefined ? Number(match[4]) : (more.at(-1) ?? Number(match[2]))
    found.push(span(Number(match[1]), Number(match[2]), last))
  }
  for (const match of name.matchAll(NXNN)) {
    // A range across two seasons (2x07-3x08) holds one episode of each: it reads none.
    if (match[3] !== undefined && Number(match[3]) !== Number(match[1])) found.push(undefined)
    else found.push(span(Number(match[1]), Number(match[2]), match[4] !== undefined ? Number(match[4]) : undefined))
  }
  if (!found.length) return null
  const [first] = found
  return first && found.every((episode) => episode && episode.season === first.season && episode.first === first.first && episode.last === first.last)
    ? first
    : undefined
}

/** The seasons a name states on its own, `SxxEyy` and `1x01` included. */
function seasonsOf(name: string): number[] {
  return [...name.matchAll(SEASON)].map((match) => Number(match[1] ?? match[2] ?? match[3]))
}

/**
 * The episode a video holds, from its path and the torrent's name (`hint`, for files qBittorrent put
 * in no folder of the torrent's), or undefined when it doesn't read one beyond doubt.
 */
export function episodeOf(path: string, hint?: string): Episode | undefined {
  const parts = path.split('/')
  const name = stem(parts.pop() ?? '')
  // Every season the path states must be one and the same; the torrent's name counts only for a
  // video in no folder, since a folder of the torrent's names its own season.
  const seasons = [...parts, name, ...(hint === undefined || parts.length ? [] : [hint])].flatMap(seasonsOf)
  const named = namedEpisode(name)
  if (named === undefined) return undefined
  if (named) return seasons.every((season) => season === named.season) ? named : undefined
  const season = single(seasons)
  if (season === undefined) return undefined
  const markers = [...name.matchAll(EPISODE)].map((match) =>
    match[3] !== undefined ? span(season, Number(match[3])) : span(season, Number(match[1]), match[2] !== undefined ? Number(match[2]) : undefined),
  )
  const [first] = markers
  return first && markers.every((episode) => episode && episode.first === first.first && episode.last === first.last) ? first : undefined
}

const pad = (number: number) => String(number).padStart(2, '0')

/** `S01E01`, or `S01E01-E02` for a file of several. */
export function episodeName({ season, first, last }: Episode): string {
  return `S${pad(season)}E${pad(first)}${last > first ? `-E${pad(last)}` : ''}`
}

const overlap = (a: Episode, b: Episode) => a.season === b.season && a.first <= b.last && b.first <= a.last

/**
 * The renames that name a series' episodes for a media server, from the torrent's files as
 * qBittorrent lists them, or why none are named. `hint` is the torrent's name, for files in no
 * folder of the torrent's.
 */
export function seriesNames(files: readonly NamedFile[], title: string, year?: number, hint?: string): MediaNames {
  if (files.some((file) => DISC_FOLDER.test(file.name))) return { named: false, reason: 'disc' }
  const videos = files.filter((file) => isVideo(file.name))
  if (!videos.length) return { named: false, reason: 'no-video' }
  const root = rootFolder(files.map((file) => file.name))
  const read = new Map<NamedFile, Episode>()
  const unread: string[] = []
  for (const video of videos) {
    if (SAMPLE.test(video.name)) continue
    const episode = episodeOf(video.name, hint)
    if (episode) read.set(video, episode)
    else unread.push(belowRoot(video.name, root))
  }
  // Two videos of one episode (versions, a repack beside the original): neither is named.
  const twice = [...read].filter(([video, episode]) => [...read].some(([other, theirs]) => other !== video && overlap(episode, theirs)))
  for (const [video] of twice) {
    read.delete(video)
    unread.push(belowRoot(video.name, root))
  }
  if (!read.size) return { named: false, reason: 'no-episodes' }

  const show = titleName(title, year, 'tv')
  // Some files in the show's folder and some not, as a rename that stopped partway leaves them:
  // naming them again would put the show's folder in itself.
  const inShow = (path: string) => path.includes('/') && path.split('/')[0].toLowerCase() === show.toLowerCase()
  if (files.some((file) => inShow(file.name)) && files.some((file) => !inShow(file.name))) return { named: false, reason: 'split' }
  const season = single([...read.values()].map((episode) => episode.season))
  // A torrent of one season keeps its other files in that season's folder, so seasons that share
  // the show's folder don't share them; a season's folder of the torrent's becomes naming's own.
  const kept = (path: string) => {
    const [first, ...below] = belowRoot(path, root).split('/')
    const folder = below.length ? SEASON_FOLDER.exec(first) : null
    if (folder) return `Season ${pad(Number(folder[1] ?? folder[2] ?? folder[3]))}/${below.join('/')}`
    return season === undefined ? [first, ...below].join('/') : `Season ${pad(season)}/${[first, ...below].join('/')}`
  }
  const episodeFile = (episode: Episode, suffix: string) => `Season ${pad(episode.season)}/${show} ${episodeName(episode)}${suffix}`
  const targets = files.map((file) => {
    let own: string | undefined
    const episode = read.get(file)
    if (episode) own = episodeFile(episode, `.${extension(file.name)}`)
    else if (!isVideo(file.name)) {
      // A file named after an episode's video, in its folder: subtitles, audio.
      const video = [...read.keys()].find((video) => parent(file.name) === parent(video.name) && base(file.name).startsWith(`${stem(base(video.name))}.`))
      if (video) own = episodeFile(read.get(video)!, base(file.name).slice(stem(base(video.name)).length))
    }
    return { file, own, to: `${show}/${own ?? kept(file.name)}` }
  })
  // Files naming would put in one place (a file of the torrent's folder and one of its season folder
  // of the same name), or a file it would put where another one is now, letters' case aside: qBittorrent
  // refuses a rename onto a file that's there, even one a later rename would move away, or applies
  // the second over the first. Rare torrents, so naming says nothing rather than order the renames.
  const now = new Set(files.map((file) => file.name.toLowerCase()))
  const places = new Set<string>()
  for (const { file, to } of targets) {
    const place = to.toLowerCase()
    if (places.has(place) || (place !== file.name.toLowerCase() && now.has(place))) return { named: false, reason: 'same-place' }
    places.add(place)
  }
  const renames: FileRename[] = []
  const named: { from: string; to: string }[] = []
  for (const { file, own, to } of targets) {
    if (to === file.name) continue
    renames.push({ from: file.name, to })
    if (own) named.push({ from: belowRoot(file.name, root), to: own })
  }
  return { named: true, renames, folder: { from: root, to: show }, files: named, unread }
}

/**
 * A file qBittorrent lists (by its path under its torrent's save path) placed under that save path,
 * with "/" between folders: torrents saved in different folders, one in the show's folder itself, say,
 * compare their files so.
 */
export function placed(savePath: string, path: string): string {
  return `${savePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`
}

/**
 * Another torrent with a file where naming would put one of this one's, or a file where naming needs
 * a folder, or the other way round: the seasons of one show share its folder (docs/SPEC.md's decision
 * log), so naming checks their files, each `placed` under its torrent's save path, in any case. A
 * torrent whose files couldn't be read (`files` undefined) counts as one in the way: naming says nothing.
 */
export function filesTakenBy<T>(paths: readonly string[], others: readonly { torrent: T; files: readonly string[] | undefined }[]): T | undefined {
  const ours = paths.map((path) => path.toLowerCase())
  const clash = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  return others.find(({ files }) => !files || files.some((file) => ours.some((path) => clash(path, file.toLowerCase()))))?.torrent
}

/** Where each file is once the renames are applied: what `filesTakenBy` compares. */
export function namedPaths(files: readonly NamedFile[], renames: readonly FileRename[]): string[] {
  const to = new Map(renames.map((rename) => [rename.from, rename.to]))
  return files.map((file) => to.get(file.name) ?? file.name)
}

/** What naming for a media server does with a torrent of this title: a movie's main video, or a series' episodes. */
export function titleNames(
  title: { type: 'movie' | 'tv'; title: string; year?: number },
  files: readonly NamedFile[],
  /** The torrent's name, for a series' files in no folder of the torrent's. */
  hint?: string,
): MediaNames {
  return title.type === 'movie' ? movieNames(files, title.title, title.year) : seriesNames(files, title.title, title.year, hint)
}
