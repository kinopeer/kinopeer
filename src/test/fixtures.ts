/**
 * Test data shared by the jsdom tests (src/), the server tests (server/) and the screenshot tests
 * (e2e/). Pure TypeScript on purpose: no React, DOM or Node APIs, only the API types, so every
 * project can import it; the imports name their `.ts` extension because the server and e2e
 * tsconfigs resolve modules the Node way.
 *
 * The screenshot baselines are rendered from these values: names, sizes, dates, the order of the
 * lists and NOW must not change without re-rendering them (docs/TESTING.md).
 */
import type { Release } from '../api/prowlarr/types.ts'
import type { MainData, ServerState, Torrent, TorrentFile } from '../api/qbittorrent/types.ts'
import type { MovieDetails, MovieResult, Paged, Title, TvDetails, TvResult } from '../api/tmdb/types.ts'

export const GB = 1024 ** 3
export const MB = 1024 ** 2
/** 2026-10-24 12:00 UTC, the time the tests freeze the clock at. */
export const NOW = Date.UTC(2026, 9, 24, 12)

const hour = 3600
const day = 86_400_000

// qBittorrent

/**
 * A torrent as /sync/maindata reports it: a 10 GB download at rest, added at NOW. The byte counts
 * follow `size` and `progress` unless given, as qBittorrent's do.
 */
export function torrent(hash: string, fields: Partial<Torrent> = {}): Torrent {
  const size = fields.size ?? 10 * GB
  const downloaded = Math.round(size * (fields.progress ?? 0))
  return {
    hash,
    name: hash,
    state: 'downloading',
    progress: 0,
    size,
    total_size: size,
    downloaded,
    uploaded: 0,
    amount_left: size - downloaded,
    dlspeed: 0,
    upspeed: 0,
    dl_limit: 0,
    up_limit: 0,
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

/** The tag Kinoseed puts on a torrent it adds, so its title is known without guessing. */
export const tmdbTag = (type: 'movie' | 'tv', id: number) => `tmdb:${type}:${id}`

/** Every status the design has, a queue position, speed limits, and a release TMDB doesn't know. */
export const TORRENTS: Torrent[] = [
  torrent('a1', {
    name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.DV.TrueHD.Atmos-FGT',
    tags: tmdbTag('movie', 693134),
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
    // Speed limits of its own, in bytes/s: here the download, on Severance the upload, on
    // Oppenheimer both.
    dl_limit: 25_000_000,
    added_on: NOW / 1000 - hour,
  }),
  torrent('a2', {
    name: 'Shogun.S01.2160p.DSNP.WEB-DL.DDP5.1.HDR.H.265',
    tags: tmdbTag('tv', 126308),
    category: 'TV Shows',
    state: 'stalledDL',
    progress: 0.18,
    size: 42 * GB,
    priority: 2,
    added_on: NOW / 1000 - 2 * hour,
  }),
  torrent('a3', {
    name: 'Everything.Everywhere.All.at.Once.2022.1080p.BluRay.x264',
    tags: tmdbTag('movie', 545611),
    category: 'Movies',
    state: 'queuedDL',
    progress: 0,
    size: 12.4 * GB,
    priority: 3,
    added_on: NOW / 1000 - 3 * hour,
  }),
  torrent('a4', {
    name: 'Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264',
    tags: tmdbTag('tv', 95396),
    category: 'TV Shows',
    state: 'uploading',
    progress: 1,
    size: 24.1 * GB,
    upspeed: 640 * 1024,
    ratio: 1.42,
    up_limit: 1_000_000,
    added_on: NOW / 1000 - 26 * hour,
  }),
  torrent('a5', {
    name: 'Oppenheimer.2023.1080p.BluRay.DDP5.1.x265.10bit',
    tags: tmdbTag('movie', 872585),
    category: 'Movies',
    state: 'stoppedDL',
    progress: 0.41,
    size: 18.7 * GB,
    dl_limit: 5_000_000,
    up_limit: 500_000,
    added_on: NOW / 1000 - 30 * hour,
  }),
  torrent('a6', {
    name: 'The.Bear.S03.1080p.HULU.WEB-DL.DDP5.1.H.264',
    tags: tmdbTag('tv', 136315),
    category: 'TV Shows',
    state: 'stoppedUP',
    progress: 1,
    size: 9.8 * GB,
    ratio: 2.05,
    added_on: NOW / 1000 - 50 * hour,
  }),
  torrent('a7', {
    name: 'Interstellar.2014.IMAX.2160p.UHD.BluRay.x265.10bit.HDR',
    tags: tmdbTag('movie', 157336),
    category: 'Movies',
    state: 'checkingDL',
    progress: 0.87,
    size: 61 * GB,
    added_on: NOW / 1000 - 70 * hour,
  }),
  torrent('a8', {
    name: 'Breaking.Bad.S01-S05.1080p.BluRay.x264',
    tags: tmdbTag('tv', 1396),
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

/** A Dune download in progress, tagged by Kinoseed: the torrent the details tests open. */
export const DUNE_TORRENT = torrent('dune', {
  name: 'Dune.Part.Two.2024.2160p.WEB-DL',
  tags: tmdbTag('movie', 693134),
  category: 'Movies',
  progress: 0.42,
  size: 20_000_000_000,
  dlspeed: 4_300_000,
  upspeed: 120_000,
  eta: 720,
  ratio: 0.31,
  num_seeds: 12,
  num_complete: 340,
  num_leechs: 3,
  num_incomplete: 41,
  save_path: '/data/movies',
  added_on: 1_760_000_000,
  priority: 1,
})

/** Not tagged by Kinoseed: its title is guessed from the release name, so the app asks whether it's right. */
export const GUESSED = torrent('b1', {
  name: 'Inception.2010.1080p.BluRay.x264-SPARKS',
  state: 'uploading',
  progress: 1,
  size: 12.4 * GB,
  ratio: 1.3,
  upspeed: 640 * 1024,
  added_on: NOW / 1000 - 30 * hour,
})

/**
 * A full /sync/maindata answer: the torrents keyed by hash, and a server state whose speeds are
 * their sum. `serverState` overrides what a test wants to see (free space, for instance).
 */
export function mainData(torrents: Torrent[] = TORRENTS, serverState: Partial<ServerState> = {}): MainData {
  return {
    rid: 1,
    full_update: true,
    torrents: Object.fromEntries(torrents.map(({ hash, ...fields }) => [hash, fields])),
    server_state: {
      dl_info_speed: torrents.reduce((sum, item) => sum + item.dlspeed, 0),
      up_info_speed: torrents.reduce((sum, item) => sum + item.upspeed, 0),
      free_space_on_disk: 1.82 * 1024 * GB,
      connection_status: 'connected',
      use_alt_speed_limits: false,
      ...serverState,
    },
  }
}

// TMDB

/** A TMDB title in both languages the app asks for. */
export interface FixtureTitle {
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

const posterPath = (title: FixtureTitle) => `/${title.type}-${title.id}.svg`

/** A search or list result as TMDB's API returns it, in the requested language. */
export function result(title: FixtureTitle, language: string): MovieResult | TvResult {
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

/** One page of TMDB results. */
export function page(titles: FixtureTitle[], language: string): Paged<MovieResult | TvResult> {
  return { page: 1, results: titles.map((title) => result(title, language)), total_pages: 1, total_results: titles.length }
}

const GENRES = {
  en: [
    { id: 878, name: 'Science Fiction' },
    { id: 12, name: 'Adventure' },
    { id: 18, name: 'Drama' },
  ],
  ru: [
    { id: 878, name: 'фантастика' },
    { id: 12, name: 'приключения' },
    { id: 18, name: 'драма' },
  ],
}

const OVERVIEW = {
  en: 'A long overview, so the title page shows how a few lines of text wrap under the poster and the genres. It goes on for a while, the way TMDB overviews often do, and then ends.',
  ru: 'Длинное описание, чтобы было видно, как несколько строк текста переносятся под постером и жанрами. Оно тянется какое-то время, как часто бывает в TMDB, а потом заканчивается.',
}

/** Oppenheimer's overview is long on purpose: the desktop hero cuts it to a few lines with "Show more". */
export const LONG_OVERVIEW_ID = 872585

const LONG_OVERVIEW = {
  en: 'A long overview, the way TMDB often has for a well-known title, so the desktop hero shows how it is cut to a few lines with a button for the rest. It begins with the setting and the years the story covers, goes on to the people around the main character and what each of them wants, and then to the project itself: the secrecy, the deadlines, the doubts and the arguments in the laboratory and outside it. After that it describes the test, the way the news of it spreads and what it changes for everyone involved, and finally the hearings years later, where the same people meet again with different roles. It does not end soon, and that is the point of it here.',
  ru: 'Длинное описание, какое в TMDB часто бывает у известного фильма, чтобы было видно, как десктопный хиро обрезает его до нескольких строк с кнопкой для остального. Оно начинается с места действия и лет, которые охватывает история, переходит к людям вокруг главного героя и к тому, чего каждый из них хочет, а затем к самому проекту: к секретности, срокам, сомнениям и спорам в лаборатории и за её пределами. Потом оно рассказывает об испытании, о том, как расходится весть о нём и что оно меняет для всех участников, и наконец о слушаниях много лет спустя, где те же люди встречаются снова уже в других ролях. Заканчивается оно нескоро, и в этом здесь весь смысл.',
}

/** TMDB's details for a title in TITLES, or undefined for an unknown one. */
export function details(type: string, id: number, language: string): MovieDetails | TvDetails | undefined {
  const title = TITLES.find((item) => item.type === type && item.id === id)
  if (!title) return undefined
  const lang = language.startsWith('ru') ? 'ru' : 'en'
  const overview = id === LONG_OVERVIEW_ID ? LONG_OVERVIEW[lang] : OVERVIEW[lang]
  const common = { genres: GENRES[lang], overview, tagline: '', status: 'Released' }
  const item = result(title, language)
  return title.type === 'movie'
    ? { ...(item as MovieResult), ...common, runtime: 166, imdb_id: null }
    : {
        ...(item as TvResult),
        ...common,
        episode_run_time: [58],
        last_air_date: null,
        in_production: false,
        number_of_seasons: 1,
        number_of_episodes: 10,
        seasons: [],
      }
}

/** A title as the TMDB client hands it to the app: what lists, cards and matches work with. */
export function title(type: Title['type'], id: number, name: string, year?: number, fields: Partial<Title> = {}): Title {
  return {
    type,
    id,
    title: name,
    originalTitle: name,
    year,
    overview: '',
    posterPath: `/${id}.jpg`,
    backdropPath: null,
    rating: 7,
    ...fields,
  }
}

// The client's SearchPage spelled out: the server's tests compile this file too, and can't follow the client's
// imports, which have no extensions.
interface SearchPageFields {
  page: number
  totalPages: number
  totalResults: number
}

/** One page of search results, the only one unless `fields` says there are more. */
export function searchPage(titles: Title[], fields: Partial<SearchPageFields> = {}): SearchPageFields & { titles: Title[] } {
  return { titles, page: 1, totalPages: 1, totalResults: titles.length, ...fields }
}

// Prowlarr

/** A release as Kinoseed's server hands it to the browser. */
export function release(id: string, title: string, size: number, seeders: number, indexer = 'Kinozal'): Release {
  return { id, title, indexer, size, seeders, leechers: 3, categories: [2000], download: `1/download?link=${id}`, infoUrl: `https://tracker.test/${id}` }
}

/** Three Dune releases: a remux, a Russian dub and a small one, two indexers. */
export const DUNE_RELEASES: Release[] = [
  release('a', 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC-FGT', 78e9, 214, 'RuTracker'),
  release('b', 'Дюна 2 / Dune: Part Two (2024) WEB-DL 1080p | Дубляж', 9.4e9, 2451),
  release('c', 'Dune.Part.Two.2024.720p.BluRay.x264-VARYG', 4.7e9, 12),
]

/** Releases for any search: the usual mix of trackers, qualities, voice-overs and very long names. */
export const RELEASES: Release[] = [
  {
    id: 'r1',
    title: 'Сёгун / Shōgun [S01] (2024) WEB-DL 2160p | HDR10, Dolby Vision | LostFilm, HDRezka Studio, Original',
    indexer: 'RuTor',
    infoUrl: 'https://rutor.info/torrent/1098971',
    size: 61.4 * GB,
    seeders: 212,
    leechers: 31,
    publishDate: new Date(NOW - 3 * day).toISOString(),
    categories: [5000],
    download: 'shogun',
  },
  {
    id: 'r2',
    title: 'Shogun.2024.S01.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX',
    indexer: 'NNM-Club',
    infoUrl: 'https://nnmclub.to/forum/viewtopic.php?t=1891242',
    size: 72.9 * GB,
    seeders: 148,
    leechers: 12,
    publishDate: new Date(NOW - 10 * day).toISOString(),
    categories: [5000],
    download: 'shogun',
  },
  {
    id: 'r3',
    title: 'Сёгун / Shogun [01x01-10 из 10] (2024) WEB-DL 1080p | NewStudio',
    indexer: 'RuTor',
    infoUrl: 'https://rutor.info/torrent/1098973',
    size: 21.7 * GB,
    seeders: 96,
    leechers: 8,
    publishDate: new Date(NOW - 40 * day).toISOString(),
    categories: [5000],
    download: 'shogun',
  },
  {
    id: 'r4',
    title: 'Shogun.S01.1080p.BluRay.x264-ROVERS',
    indexer: 'NNM-Club',
    infoUrl: 'https://nnmclub.to/forum/viewtopic.php?t=1891244',
    size: 38.2 * GB,
    seeders: 41,
    leechers: 3,
    publishDate: new Date(NOW - 90 * day).toISOString(),
    categories: [5040],
    download: 'shogun',
  },
  {
    id: 'r5',
    title: 'Сёгун (1 сезон: 1-10 серии из 10) / Shōgun / 2024 / ПМ (HDrezka Studio) / WEB-DLRip 720p',
    indexer: 'RuTor',
    infoUrl: 'https://rutor.info/torrent/1098975',
    size: 9.6 * GB,
    seeders: 12,
    leechers: 1,
    publishDate: new Date(NOW - 120 * day).toISOString(),
    categories: [8000],
    download: 'shogun',
  },
  {
    id: 'r6',
    title: 'Shogun S01E01 Anjin 720p HEVC x265',
    indexer: 'RuTor',
    infoUrl: 'https://rutor.info/torrent/1098976',
    size: 640 * MB,
    seeders: 0,
    leechers: 0,
    publishDate: new Date(NOW - 200 * day).toISOString(),
    categories: [5000],
    magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000001',
  },
]

// Torrent files

const EPISODES = ['Anjin', 'Servants of Two Masters', 'Tomorrow Is Tomorrow', 'The Eightfold Fence', 'Broken to the Fist', 'Ladies of the Willow World', 'A Stick of Time', 'The Abyss of Life', 'Crimson Sky', 'A Dream of a Dream']

/** The files of the Shōgun release: a season folder of episodes and subtitles, inside the torrent's own folder. */
export const SHOGUN_FILES = [
  ...EPISODES.map((name, index) => ({
    path: `Episodes/Shogun.S01E${String(index + 1).padStart(2, '0')}.${name.replaceAll(' ', '.')}.2160p.mkv`,
    size: Math.round((5.6 + (index % 3) * 0.4) * GB),
  })),
  { path: 'Subs/Russian.Forced.srt', size: 48 * 1024 },
  { path: 'Subs/Russian.Full.srt', size: 112 * 1024 },
  { path: 'Subs/English.SDH.srt', size: 126 * 1024 },
  { path: 'Shogun.S01.nfo', size: 6 * 1024 },
]

/** qBittorrent's file list for the downloading Shōgun torrent: some files done, one skipped. */
export function torrentFiles(): TorrentFile[] {
  return SHOGUN_FILES.map((file, index) => ({
    index,
    name: `Shogun.S01.2160p/${file.path}`,
    size: file.size,
    progress: index < 2 ? 1 : index === 2 ? 0.37 : 0,
    priority: index === 9 ? 0 : 1,
  }))
}

function bencode(value: unknown): string {
  if (typeof value === 'number') return `i${value}e`
  if (typeof value === 'string') return `${new TextEncoder().encode(value).length}:${value}`
  if (Array.isArray(value)) return `l${value.map(bencode).join('')}e`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
  return `d${entries.map(([key, item]) => bencode(key) + bencode(item)).join('')}e`
}

/** The bytes of a .torrent for the Shōgun release, enough for the browser to list its files. */
export function shogunTorrent(): Uint8Array {
  return new TextEncoder().encode(
    bencode({
      announce: 'http://tracker.invalid/announce',
      info: {
        name: 'Shogun.S01.2160p',
        'piece length': 4 * 1024 * 1024,
        pieces: 'x'.repeat(20),
        files: SHOGUN_FILES.map((file) => ({ length: file.size, path: file.path.split('/') })),
      },
    }),
  )
}
