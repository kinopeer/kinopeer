/** What a release title says about its quality, for badges and filters. */
export type Resolution = '2160p' | '1080p' | '720p' | 'SD'
/** CAM is any theater rip: a camera in the cinema, a telesync or a telecine. */
export type Source = 'REMUX' | 'BluRay' | 'BDRip' | 'WEB-DL' | 'WEBRip' | 'HDRip' | 'HDTV' | 'DVD' | 'CAM'
export type Hdr = 'DV' | 'HDR10+' | 'HDR'
export type Codec = 'HEVC' | 'AVC' | 'AV1'
/** Dubbed, multi-voice, two-voice, single-voice voice-over, original track. */
export type Audio = 'dub' | 'mvo' | 'avo2' | 'avo1' | 'orig'

export interface ReleaseInfo {
  resolution?: Resolution
  source?: Source
  codec?: Codec
  hdr: Hdr[]
  audio: Audio[]
  subs: boolean
  /** Seasons a series release covers, in order. */
  seasons: number[]
  /** "Complete series" without season numbers. */
  complete: boolean
}

// \b doesn't see Cyrillic, so Russian tokens use explicit edges.
const EDGE_START = '(?<![\\p{L}\\p{N}])'
const EDGE_END = '(?![\\p{L}\\p{N}])'
const word = (pattern: string) => new RegExp(`${EDGE_START}(?:${pattern})${EDGE_END}`, 'iu')

// A number wins over a marker: "UHD BDRip 1080p" is a 1080p rip of a UHD disc.
const RESOLUTIONS: [Resolution, RegExp][] = [
  ['2160p', word('2160[pi]')],
  ['1080p', word('1080[pi]')],
  ['720p', word('720p')],
  ['SD', word('480p|576p')],
  ['2160p', word('4k|uhd')],
  ['SD', word('sd|dvdrip|dvd5|dvd9|satrip|tvrip|vhsrip')],
]

const SOURCES: [Source, RegExp][] = [
  ['REMUX', word('(?:bd|uhd|blu-?ray)?[\\s.-]?remux|bdremux|uhdremux')],
  ['BDRip', word('bdrip|brrip|bd-rip|uhdrip|bdrip-avc|bdrip-hevc')],
  ['WEBRip', word('web-?rip|webdlrip|web-dlrip')],
  // An HD rip, usually of a WEB or HDTV source: not a Blu-ray one.
  ['HDRip', word('hdrip')],
  ['WEB-DL', word('web-?dl|webdl|web')],
  ['BluRay', word('blu-?ray|bluray|bd(?:25|50|66|100)|uhd[\\s.-]?bd|bd')],
  ['HDTV', word('hdtv(?:rip)?|hdtvrip|tvrip|satrip')],
  ['DVD', word('dvd(?:rip|5|9)?')],
  // Last, so a name with a real source keeps it. Not a bare CAM, which is also a film's name, and
  // not TS where the name says only the audio comes from one ("Звук с TS").
  ['CAM', new RegExp(`(?<!звук\\s+(?:с|из)\\s+)${EDGE_START}(?:cam-?rip|hdcam|(?:hd)?ts(?:rip)?|telesynch?|(?:hd)?tc|telecine)${EDGE_END}`, 'iu')],
]

const CODECS: [Codec, RegExp][] = [
  ['HEVC', word('hevc|[xh][\\s.]?265')],
  ['AVC', word('avc|[xh][\\s.]?264')],
  ['AV1', word('av1')],
]

const HDRS: [Hdr, RegExp][] = [
  ['DV', word('dv|dovi|dolby[\\s.]?vision')],
  ['HDR10+', /(?<![\p{L}\p{N}])hdr10(?:\+|plus)/iu],
  ['HDR', word('hdr(?:10)?')],
]

/**
 * Voice-over kinds as Russian trackers write them: words ("Дубляж", "Многоголосый"), English
 * shorthand ("Dub", "MVO", "DVO", "AVO") and the short codes some trackers use ("ДБ ПМ АП СТ").
 */
const AUDIO: [Audio, RegExp][] = [
  ['dub', word('дубляж|дублированный|dub|dubbed|дб')],
  ['mvo', word('многоголосый|многоголосая|mvo|пм|лм|lostfilm|newstudio|кубик в кубе|hdrezka|jaskier|amedia')],
  ['avo2', word('двухголосый|двухголосая|dvo|пд|лд')],
  ['avo1', word('одноголосый|одноголосая|авторский|avo|ап|ло')],
  ['orig', word('original|оригинал|eng')],
]

/** Credit letters some trackers use, only trusted inside a "| D, P, A |" block: D dub, P/L multi, P2/L2 two, A/L1 one. */
const AUDIO_LETTERS: [Audio, RegExp][] = [
  ['dub', word('d')],
  ['mvo', word('p|l')],
  ['avo2', word('p2|l2')],
  ['avo1', word('a|l1')],
]

const SUBS = word('subs?|субтитры|сабы|ст')

/** Everything after the first "|": where trackers list voice-overs and extras. */
function credits(title: string): string {
  const bar = title.indexOf('|')
  return bar < 0 ? '' : title.slice(bar + 1)
}

const SEASON_RANGE =
  /(?<![\p{L}\p{N}])(?:s(\d{1,2})(?:e\d{1,3})?(?:\s*[-–]\s*s?(\d{1,2}))?|(?:сезоны?|seasons?)[:\s]*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?|(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*сезон)/giu
const COMPLETE = word('complete|все сезоны|полный сериал|полностью')

function seasonsOf(title: string): number[] {
  const seasons = new Set<number>()
  for (const match of title.matchAll(SEASON_RANGE)) {
    const groups = match.slice(1)
    const pairs = [
      [groups[0], groups[1]],
      [groups[2], groups[3]],
      [groups[4], groups[5]],
    ]
    for (const [from, to] of pairs) {
      if (from === undefined) continue
      const start = Number(from)
      const end = to === undefined ? start : Number(to)
      if (end < start || end - start > 40) continue
      for (let season = start; season <= end; season++) seasons.add(season)
    }
  }
  return [...seasons].sort((a, b) => a - b)
}

function first<T>(table: [T, RegExp][], text: string): T | undefined {
  return table.find(([, pattern]) => pattern.test(text))?.[0]
}

const AUDIO_ORDER: Audio[] = ['dub', 'mvo', 'avo2', 'avo1', 'orig']

export function parseRelease(title: string): ReleaseInfo {
  // Dots and underscores separate words in scene names: "Dune.Part.Two.2024.2160p.WEB-DL".
  const text = title.replace(/[._]+/g, ' ')
  const block = credits(text)

  const audio = [...new Set([
    ...AUDIO.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind),
    ...AUDIO_LETTERS.filter(([, pattern]) => pattern.test(block)).map(([kind]) => kind),
  ])].sort((a, b) => AUDIO_ORDER.indexOf(a) - AUDIO_ORDER.indexOf(b))

  return {
    resolution: first(RESOLUTIONS, text),
    source: first(SOURCES, text),
    codec: first(CODECS, text),
    hdr: HDRS.filter(([, pattern]) => pattern.test(text))
      .map(([kind]) => kind)
      // "HDR10+" also matches the plain HDR pattern.
      .filter((kind, _, all) => !(kind === 'HDR' && all.includes('HDR10+'))),
    audio,
    subs: SUBS.test(text),
    seasons: seasonsOf(text),
    complete: COMPLETE.test(text),
  }
}

/** "S03", "S01–S05", or undefined for a movie. */
export function seasonCoverage(info: Pick<ReleaseInfo, 'seasons'>): string | undefined {
  const { seasons } = info
  if (!seasons.length) return undefined
  const pad = (season: number) => `S${String(season).padStart(2, '0')}`
  const contiguous = seasons.every((season, index) => index === 0 || season === seasons[index - 1] + 1)
  if (seasons.length === 1) return pad(seasons[0])
  return contiguous ? `${pad(seasons[0])}–${pad(seasons.at(-1)!)}` : seasons.map(pad).join(', ')
}

// "S02E01-E05", "S02E03", "Серии 1-5": the episodes a release covers within its season.
const EPISODES = new RegExp(
  `${EDGE_START}(?:s\\d{1,2}e(\\d{1,3})(?:\\s*[-–]\\s*e?(\\d{1,3}))?|(?:серии|серия|episodes?)[:\\s]*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)${EDGE_END}`,
  'iu',
)

/** "E01–05", "E03", or undefined when the title doesn't name episodes. */
export function episodeCoverage(title: string): string | undefined {
  const match = EPISODES.exec(title.replace(/[._]+/g, ' '))
  if (!match) return undefined
  const from = Number(match[1] ?? match[3])
  const to = match[2] ?? match[4]
  const pad = (episode: number) => String(episode).padStart(2, '0')
  return to !== undefined && Number(to) > from ? `E${pad(from)}–${pad(Number(to))}` : `E${pad(from)}`
}

/** "S02 E01–05" for part of one season, otherwise what `seasonCoverage` says. */
export function releaseCoverage(title: string, info: Pick<ReleaseInfo, 'seasons'> = parseRelease(title)): string | undefined {
  const seasons = seasonCoverage(info)
  if (!seasons || info.seasons.length !== 1) return seasons
  const episodes = episodeCoverage(title)
  return episodes ? `${seasons} ${episodes}` : seasons
}
