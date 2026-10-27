/**
 * The test side of the smoke stand (stack.ts): where it listens, what it knows, and the control
 * calls the journeys make. The journeys run in Playwright's process and the stand in its own, so
 * the fakes' state travels over HTTP: `resetStand()` restarts the server in a known state before
 * a journey, `standState()` reads what the fakes saw and what the server saved after it.
 */
import { createHash } from 'node:crypto'
import type { Matches } from '../../src/api/matches/types.ts'
import type { Torrent } from '../../src/api/qbittorrent/types.ts'
import { shogunTorrent } from '../../src/test/fixtures.ts'

/** The proxy in front of the server: the journeys' baseURL. */
export const PROXY_PORT = 4300
/** The production server itself, behind the proxy. */
export const APP_PORT = 4310
/** The stand's control server. */
export const CONTROL_PORT = 4320
export const PROXY_URL = `http://localhost:${PROXY_PORT}`
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`

/** The cookie the proxy sets on a page load, as Umbrel's app_proxy does at login. */
export const PROXY_COOKIE = 'proxy_session'
/** On the proxy's own 401, to tell it from one the server could send. */
export const PROXY_DENIED_HEADER = 'x-smoke-proxy'

/** The only login the fake qBittorrent takes (server/test/fakes.ts). */
export const LOGIN = { username: 'admin', password: 'pass word' }
/** The only key the fake TMDB accepts. */
export const TMDB_KEY = 'good-key'
/** The key the server sends to the fake Prowlarr; the browser must never see it. */
export const PROWLARR_KEY = 'smoke-prowlarr-key'

/** What `resetStand` starts the server with. */
export interface ResetOptions {
  /** false: no qBittorrent login and no TMDB key saved, for onboarding. Default true. */
  configured?: boolean
  /** What the fake qBittorrent lists; the fixtures' TORRENTS by default. */
  torrents?: Torrent[]
  /** What matches.json holds before the server starts; nothing by default. */
  matches?: Matches
}

/**
 * What the fakes saw and the server saved since the last reset, as JSON: the fakes' records from
 * server/test/fakes.ts (stack.ts checks they fit), with a file's bytes reduced to its size.
 */
export interface StandState {
  qbittorrent: {
    /** Every request past the login, with the cookie it carried. */
    seen: { method?: string; url?: string; cookie?: string; contentType?: string; body: string }[]
    /** /torrents/add calls. */
    added: { files: { name: string; size: number }[]; tags: string[]; category?: string; stopped: boolean }[]
    /** /torrents/delete calls. */
    deleted: { hashes: string[]; deleteFiles: boolean }[]
    /** Login attempts, right and wrong. */
    logins: number
    /** The hashes it lists now. */
    torrents: string[]
  }
  tmdb: { seen: { url?: string; authorization?: string; cookie?: string }[] }
  prowlarr: { seen: { url?: string; key?: string }[] }
  /** settings.json (server/settings.ts), or null before the server saved anything. */
  settings: { tmdbApiKey?: string; qbittorrentUsername?: string; qbittorrentPassword?: string } | null
  /** matches.json, or null while nothing was saved. */
  matches: Matches | null
}

/** Restarts the server with a fresh data directory and fresh fakes, in the given state. */
export async function resetStand(options: ResetOptions = {}): Promise<void> {
  const response = await fetch(`${CONTROL_URL}/__reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  if (!response.ok) throw new Error(`The smoke stand could not reset: ${response.status} ${await response.text()}`)
}

export async function standState(): Promise<StandState> {
  const response = await fetch(`${CONTROL_URL}/__state`)
  if (!response.ok) throw new Error(`The smoke stand has no state: ${response.status}`)
  return (await response.json()) as StandState
}

/**
 * The info hash of a .torrent whose info dictionary is its last key, as the fixtures' is (bencode
 * sorts keys, and "info" comes after "announce"): SHA-1 of the bytes from after "4:info" to the
 * outer dictionary's closing "e".
 */
export function infoHash(torrent: Uint8Array): string {
  const bytes = Buffer.from(torrent)
  const start = bytes.indexOf('4:info') + '4:info'.length
  return createHash('sha1').update(bytes.subarray(start, bytes.length - 1)).digest('hex')
}

/** The hash qBittorrent gives the Shōgun release's torrent. */
export const SHOGUN_HASH = infoHash(shogunTorrent())
