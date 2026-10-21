import type { MediaType } from '../api/tmdb'

/** What a release name says about the title, for looking it up in TMDB. */
export interface ParsedName {
  title: string
  year?: number
  /** Set when the name has season or episode markers. */
  type?: MediaType
  season?: number
}

/** Kinoseed tags torrents it adds as `tmdb:movie:693134`; that beats any guess from the name. */
const TAG = /^tmdb:(movie|tv):(\d+)$/

export function tmdbTag(tags: string): { type: MediaType; id: number } | undefined {
  for (const tag of tags.split(',')) {
    const match = TAG.exec(tag.trim())
    if (match) return { type: match[1] as MediaType, id: Number(match[2]) }
  }
  return undefined
}

const YEARS = /(?<=^|[\s([])(?:19|20)\d{2}(?=$|[\s)\]])/g
// S01E02, S01, S01-S03, Season 1, Сезон 1, 1x02
const SEASON = /\b(?:s(\d{1,2})(?:e\d{1,3}|-s?\d{1,2})?|season[\s:]*(\d{1,2})|(\d{1,2})x\d{2})\b|сезон[\s:]*(\d{1,2})|(\d{1,2})\s*сезон/iu
// The first technical token ends the title.
const NOISE =
  /\b(?:\d{3,4}p|[48]k|uhd|hdr\d*|dv|web[\s-]?(?:dl|rip)?|blu[\s-]?ray|bdrip|bdremux|remux|hdtv|hdrip|dvdrip|dvd\d?|x26[45]|h[\s.]?26[45]|hevc|avc|aac|ac3|dts|ddp?\d?|atmos|truehd|imax|proper|repack|extended|unrated|complete|multi|rus?|eng?)\b/i

function clean(text: string): string {
  return text
    .replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')
    .replace(/^(?:\[[^\]]*\]\s*)+/, '') // leading [Group] tags
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort guess of the title from a scene or tracker release name, e.g.
 * "Dune.Part.Two.2024.2160p.WEB-DL" → { title: "Dune Part Two", year: 2024 } or
 * "Дюна / Dune (2021) BDRip 1080p" → { title: "Дюна", year: 2021 }.
 */
export function parseName(name: string): ParsedName {
  let text = clean(name)

  // "Russian title / Original title (2021) ...": the first title is enough for TMDB.
  const slash = text.indexOf(' / ')
  const rest = slash >= 0 ? text.slice(slash) : ''
  if (slash > 0) text = text.slice(0, slash)

  const noise = NOISE.exec(text)
  const seasonMatch = SEASON.exec(text) ?? SEASON.exec(rest)
  let end = text.length
  for (const match of [noise, SEASON.exec(text)]) {
    if (match && match.index > 0) end = Math.min(end, match.index)
  }
  // The release year comes last before the technical part ("Blade Runner 2049 2017 1080p");
  // a year at the very start is the title itself ("1917").
  const yearMatch = [...text.matchAll(YEARS)].filter((match) => match.index > 0 && match.index < end).at(-1)
  if (yearMatch) end = Math.min(end, yearMatch.index)
  const year = yearMatch ? Number(yearMatch[0]) : [...rest.matchAll(YEARS)].map((match) => Number(match[0]))[0]
  const title = text
    .slice(0, end)
    .replace(/[\s([{\-–—:,]+$/, '')
    .trim()

  const season = seasonMatch ? Number(seasonMatch.slice(1).find((group) => group !== undefined)) : undefined

  return {
    title: title || text,
    year,
    type: seasonMatch ? 'tv' : undefined,
    season,
  }
}
