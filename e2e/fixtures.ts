import type { MainData, Torrent } from '../src/api/qbittorrent/types.ts'
import type { MovieDetails, MovieResult, Paged, TvDetails, TvResult } from '../src/api/tmdb/types.ts'

/** A TMDB title in both languages the app asks for. */
interface FixtureTitle {
  type: 'movie' | 'tv'
  id: number
  en: string
  ru: string
  original: string
  date: string
  rating: number
}

export const TITLES: FixtureTitle[] = [
  { type: 'movie', id: 693134, en: 'Dune: Part Two', ru: 'Дюна: Часть вторая', original: 'Dune: Part Two', date: '2024-02-27', rating: 8.1 },
  { type: 'tv', id: 126308, en: 'Shōgun', ru: 'Сёгун', original: 'Shōgun', date: '2024-02-27', rating: 8.6 },
  // Long on purpose: the grid clamps titles to two lines.
  { type: 'movie', id: 545611, en: 'Everything Everywhere All at Once', ru: 'Всё везде и сразу', original: 'Everything Everywhere All at Once', date: '2022-03-24', rating: 7.8 },
  { type: 'tv', id: 95396, en: 'Severance', ru: 'Разделение', original: 'Severance', date: '2022-02-17', rating: 8.4 },
  { type: 'movie', id: 872585, en: 'Oppenheimer', ru: 'Оппенгеймер', original: 'Oppenheimer', date: '2023-07-19', rating: 8.1 },
  { type: 'tv', id: 136315, en: 'The Bear', ru: 'Медведь', original: 'The Bear', date: '2022-06-23', rating: 8.2 },
  { type: 'movie', id: 157336, en: 'Interstellar', ru: 'Интерстеллар', original: 'Interstellar', date: '2014-11-05', rating: 8.5 },
  { type: 'tv', id: 1396, en: 'Breaking Bad', ru: 'Во все тяжкие', original: 'Breaking Bad', date: '2008-01-20', rating: 8.9 },
  { type: 'movie', id: 27205, en: 'Inception', ru: 'Начало', original: 'Inception', date: '2010-07-15', rating: 8.4 },
  { type: 'movie', id: 496243, en: 'Parasite', ru: 'Паразиты', original: '기생충', date: '2019-05-30', rating: 8.5 },
]

const GB = 1024 ** 3
const MB = 1024 ** 2
/** 2026-10-24 12:00 UTC, the time the tests freeze the clock at. */
export const NOW = Date.UTC(2026, 9, 24, 12)

function torrent(hash: string, fields: Partial<Torrent>): Torrent {
  return {
    hash,
    name: hash,
    state: 'downloading',
    progress: 0,
    size: 10 * GB,
    total_size: 10 * GB,
    downloaded: 0,
    uploaded: 0,
    amount_left: 10 * GB,
    dlspeed: 0,
    upspeed: 0,
    eta: 8_640_000,
    ratio: 0,
    num_seeds: 0,
    num_leechs: 0,
    num_complete: 40,
    num_incomplete: 12,
    category: '',
    tags: '',
    save_path: '/downloads',
    content_path: '/downloads',
    added_on: NOW / 1000,
    completion_on: 0,
    priority: -1,
    ...fields,
  }
}

const tag = (type: 'movie' | 'tv', id: number) => `tmdb:${type}:${id}`
const hour = 3600

/** Every status the design has, a queue position, and a release TMDB doesn't know. */
export const TORRENTS: Torrent[] = [
  torrent('a1', {
    name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.DV.TrueHD.Atmos-FGT',
    tags: tag('movie', 693134),
    category: 'Movies',
    state: 'downloading',
    progress: 0.62,
    size: 68 * GB,
    dlspeed: 18.4 * MB,
    upspeed: 1.2 * MB,
    eta: 2400,
    num_seeds: 54,
    num_leechs: 9,
    priority: 1,
    added_on: NOW / 1000 - hour,
  }),
  torrent('a2', {
    name: 'Shogun.S01.2160p.DSNP.WEB-DL.DDP5.1.HDR.H.265',
    tags: tag('tv', 126308),
    category: 'TV Shows',
    state: 'stalledDL',
    progress: 0.18,
    size: 42 * GB,
    priority: 2,
    added_on: NOW / 1000 - 2 * hour,
  }),
  torrent('a3', {
    name: 'Everything.Everywhere.All.at.Once.2022.1080p.BluRay.x264',
    tags: tag('movie', 545611),
    category: 'Movies',
    state: 'queuedDL',
    progress: 0,
    size: 12.4 * GB,
    priority: 3,
    added_on: NOW / 1000 - 3 * hour,
  }),
  torrent('a4', {
    name: 'Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264',
    tags: tag('tv', 95396),
    category: 'TV Shows',
    state: 'uploading',
    progress: 1,
    size: 24.1 * GB,
    upspeed: 640 * 1024,
    ratio: 1.42,
    added_on: NOW / 1000 - 26 * hour,
  }),
  torrent('a5', {
    name: 'Oppenheimer.2023.1080p.BluRay.DDP5.1.x265.10bit',
    tags: tag('movie', 872585),
    category: 'Movies',
    state: 'stoppedDL',
    progress: 0.41,
    size: 18.7 * GB,
    added_on: NOW / 1000 - 30 * hour,
  }),
  torrent('a6', {
    name: 'The.Bear.S03.1080p.HULU.WEB-DL.DDP5.1.H.264',
    tags: tag('tv', 136315),
    category: 'TV Shows',
    state: 'stoppedUP',
    progress: 1,
    size: 9.8 * GB,
    ratio: 2.05,
    added_on: NOW / 1000 - 50 * hour,
  }),
  torrent('a7', {
    name: 'Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR',
    tags: tag('movie', 157336),
    category: 'Movies',
    state: 'checkingDL',
    progress: 0.87,
    size: 61 * GB,
    added_on: NOW / 1000 - 70 * hour,
  }),
  torrent('a8', {
    name: 'Breaking.Bad.S01-S05.1080p.BluRay.x264',
    tags: tag('tv', 1396),
    category: 'TV Shows',
    state: 'missingFiles',
    progress: 0.33,
    size: 128 * GB,
    added_on: NOW / 1000 - 90 * hour,
  }),
  // No tag and no TMDB match: the row falls back to the release name and a placeholder poster.
  torrent('a9', {
    name: 'Unknown.Nature.Documentary.Collection.2023.1080p.WEB-DL.H264-GROUP',
    state: 'stalledUP',
    progress: 1,
    size: 7.3 * GB,
    ratio: 0.4,
    added_on: NOW / 1000 - 120 * hour,
  }),
]

export function mainData(torrents: Torrent[] = TORRENTS): MainData {
  return {
    rid: 1,
    full_update: true,
    torrents: Object.fromEntries(torrents.map(({ hash, ...fields }) => [hash, fields])),
    server_state: {
      dl_info_speed: torrents.reduce((sum, item) => sum + item.dlspeed, 0),
      up_info_speed: torrents.reduce((sum, item) => sum + item.upspeed, 0),
      free_space_on_disk: 1.82 * 1024 * GB,
      connection_status: 'connected',
    },
  }
}

const posterPath = (title: FixtureTitle) => `/${title.type}-${title.id}.svg`

function result(title: FixtureTitle, language: string): MovieResult | TvResult {
  const name = language.startsWith('ru') ? title.ru : title.en
  const base = {
    id: title.id,
    overview: `${name}.`,
    poster_path: posterPath(title),
    backdrop_path: null,
    vote_average: title.rating,
    vote_count: 10_000,
    popularity: 100,
    original_language: 'en',
  }
  return title.type === 'movie'
    ? { ...base, media_type: 'movie', title: name, original_title: title.original, release_date: title.date }
    : { ...base, media_type: 'tv', name, original_name: title.original, first_air_date: title.date }
}

export function page(titles: FixtureTitle[], language: string): Paged<MovieResult | TvResult> {
  return { page: 1, results: titles.map((title) => result(title, language)), total_pages: 1, total_results: titles.length }
}

export function details(type: string, id: number, language: string): MovieDetails | TvDetails | undefined {
  const title = TITLES.find((item) => item.type === type && item.id === id)
  if (!title) return undefined
  const common = { genres: [], tagline: '', status: 'Released' }
  const item = result(title, language)
  return title.type === 'movie'
    ? { ...(item as MovieResult), ...common, runtime: 150, imdb_id: null }
    : {
        ...(item as TvResult),
        ...common,
        episode_run_time: [50],
        last_air_date: null,
        in_production: false,
        number_of_seasons: 1,
        number_of_episodes: 10,
        seasons: [],
      }
}

/**
 * A stand-in poster: a diagonal gradient whose hue comes from the file name, so each title looks
 * different without shipping images. No text, so it renders the same everywhere.
 */
export function posterSvg(path: string): string {
  let hash = 0
  // The file name only, so a title looks the same at every poster size.
  for (const char of path.slice(path.lastIndexOf('/'))) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 16%)"/>
</linearGradient></defs>
<rect width="342" height="513" fill="url(#g)"/>
<circle cx="250" cy="150" r="70" fill="hsl(${(hue + 180) % 360} 70% 70% / 0.35)"/>
</svg>`
}
