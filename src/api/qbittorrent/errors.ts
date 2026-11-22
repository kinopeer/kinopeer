// What a call to qBittorrent throws, the same on both ways the client reaches it (./transport.ts).
import type { ConnectionFailure } from '../connectionFailure'
import { ProxySignInError } from '../fetchKinopeer'
import type { SourceAddress } from '../settings/types'

export class QbittorrentError extends Error {
  readonly status: number
  /** Why qBittorrent didn't answer the bridge, where the server could tell (`FAILURE_HEADER`). */
  readonly failure?: ConnectionFailure

  constructor(message: string, status: number, failure?: ConnectionFailure) {
    super(message)
    this.name = 'QbittorrentError'
    this.status = status
    this.failure = failure
  }
}

/**
 * qBittorrent added none of the torrents sent to `torrents/add`: an invalid file, or one it has
 * already. It answers 200 "Fails." up to 5.1 and 409 from 5.2 (Web API 2.14.0).
 */
export class TorrentRefusedError extends QbittorrentError {
  constructor(status: number) {
    super('qBittorrent could not add the torrent', status)
    this.name = 'TorrentRefusedError'
  }
}

/** A request failed without reaching Kinopeer's server: something in front of it answered. */
export class KinopeerUnreachableError extends QbittorrentError {
  constructor(status: number) {
    super(`Kinopeer's server did not answer (${status})`, status)
    this.name = 'KinopeerUnreachableError'
  }
}

/**
 * Who didn't answer. Kinopeer's server, two ways: `unreached`, nothing answered at all (the network,
 * a certificate the browser no longer trusts, both a TypeError with no detail) or a sign-in proxy
 * redirected the request; `kinopeer`, something in front answered for the server (Umbrel's 502 for
 * a stopped app), so the way to it works. Or `qbittorrent`: the service behind Kinopeer's bridge,
 * which is TMDB for TMDB's calls (src/api/tmdb/client.ts, #537).
 */
export type Unreachable = 'unreached' | 'kinopeer' | 'qbittorrent'

/**
 * Who a failed request didn't get an answer from: Kinopeer's server when the network failed
 * (fetch's TypeError) or a proxy in front asked to sign in (`unreached`), or answered for it
 * (`kinopeer`). Otherwise the service behind the bridge, `qbittorrent`, which is TMDB for TMDB's
 * calls. A request that took too long counts as qBittorrent: its bridge waits for qBittorrent with
 * no limit, so a request that hangs is most likely waiting on it. The TMDB bridge gives up after
 * `TMDB_TIMEOUT_MS` and answers its own 504, so for TMDB's calls that reading is only likely.
 *
 * The WebUI build has no Kinopeer server: the page calls each service itself, so the one called is
 * the one that didn't answer, qBittorrent for its own calls.
 */
export function unreachable(error: unknown): Unreachable {
  if (__WEBUI__) return 'qbittorrent'
  if (error instanceof TypeError || error instanceof ProxySignInError) return 'unreached'
  return error instanceof KinopeerUnreachableError ? 'kinopeer' : 'qbittorrent'
}

/**
 * The server has no address for qBittorrent, from its environment or saved from the app: the app
 * asks for one (src/api/settings).
 */
export class NoAddressError extends QbittorrentError {
  constructor() {
    super('qBittorrent has no address', 503)
    this.name = 'NoAddressError'
  }
}

/**
 * qBittorrent wants a login: the server has no working one (the app asks for one, see
 * src/api/settings), or, in the WebUI build, the browser's session with qBittorrent ended or never
 * began (the app shows qBittorrent's login).
 */
export class UnauthorizedError extends QbittorrentError {
  /** With no login on the server, in a container: where qBittorrent sees Kinopeer come from, for its auth bypass (#509). */
  readonly source?: SourceAddress

  constructor(source?: SourceAddress) {
    super('Not logged in to qBittorrent', 403)
    this.name = 'UnauthorizedError'
    this.source = source
  }
}
