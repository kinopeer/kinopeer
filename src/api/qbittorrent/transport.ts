// How the client reaches qBittorrent's Web API: through Kinopeer's server in the server build, from
// the browser itself in the WebUI build, where qBittorrent serves the page (docs/ARCHITECTURE.md →
// The transport). The client's calls (./client.ts) are the same on both.
import { knownFailure } from '../connectionFailure'
import { parseSource } from '../containerHints'
import { fetchKinopeer } from '../fetchKinopeer'
import { KinopeerUnreachableError, NoAddressError, QbittorrentError, UnauthorizedError } from './errors'

/** What a call sends: its method, a POST's body, and the signal that gives it up. */
export interface QbittorrentCall {
  method: 'GET' | 'POST'
  body?: FormData | URLSearchParams
  signal?: AbortSignal
}

/**
 * Sends `call` to `path` under qBittorrent's Web API (`/app/version`, a GET with its query) and
 * resolves with qBittorrent's answer when it's ok. Anything else it throws as the client's errors
 * itself, the same ones on both ways (`UnauthorizedError` when qBittorrent wants a login,
 * `QbittorrentError` with qBittorrent's status), so nothing above the client asks which build it is.
 */
export type QbittorrentTransport = (path: string, call: QbittorrentCall) => Promise<Response>

/** Same-origin prefix bridged to qBittorrent's Web API by server/qbittorrent.ts. */
export const QBITTORRENT_BASE = '/qbt/api/v2'

/**
 * The bridge's mark on each of its answers, and the TMDB bridge's (`BRIDGE_HEADER` in
 * server/qbittorrent.ts): a failure without it never reached Kinopeer's server, a proxy in front
 * answered for it.
 */
export const BRIDGE_HEADER = 'x-kinopeer-bridge'
/** The bridge's mark when it has no address for qBittorrent (`NO_ADDRESS` in server/qbittorrent.ts). */
export const NO_ADDRESS = 'no-address'
/** Beside the bridge's 502: why qBittorrent didn't answer (`FAILURE_HEADER` in server/qbittorrent.ts, #508). */
export const FAILURE_HEADER = 'x-kinopeer-failure'
/** Beside the bridge's 403: where qBittorrent sees Kinopeer come from (`SOURCE_HEADER` in server/qbittorrent.ts, #509). */
export const SOURCE_HEADER = 'x-kinopeer-source'

/**
 * Through Kinopeer's bridge, which logs in to qBittorrent itself and keeps the session: the browser
 * never holds a qBittorrent cookie.
 */
export const bridgeTransport: QbittorrentTransport = async (path, { method, body, signal }) => {
  const response = await fetchKinopeer(`${QBITTORRENT_BASE}${path}`, {
    method,
    // The server forwards only requests that carry it (server/qbittorrent.ts): another site can't
    // add a header to a request without asking first, so it can't act through Kinopeer.
    headers: { 'X-Kinopeer': '1' },
    body,
    signal,
  })
  if (!response.ok && !response.headers.has(BRIDGE_HEADER)) throw new KinopeerUnreachableError(response.status)
  if (response.headers.get(BRIDGE_HEADER) === NO_ADDRESS) throw new NoAddressError()
  if (response.status === 401 || response.status === 403) throw new UnauthorizedError(parseSource(response.headers.get(SOURCE_HEADER)))
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status, knownFailure(response.headers.get(FAILURE_HEADER)))
  return response
}

/**
 * qBittorrent's Web API where it serves the page, in the WebUI build. Relative to the page, so it
 * works on a path a reverse proxy puts qBittorrent under too, which the routes in the address's
 * fragment (`/#/…`) leave as the page's own.
 */
export const WEBUI_BASE = 'api/v2'

/**
 * Straight to qBittorrent on the page's origin, with the session cookie its login (`logIn` in
 * ./webui.ts) gave the browser. qBittorrent answers 403 to a call without a session, and checks the
 * request's Origin itself, which the browser sets.
 */
export const webuiTransport: QbittorrentTransport = async (path, { method, body, signal }) => {
  const response = await fetch(`${WEBUI_BASE}${path}`, { method, body, signal, credentials: 'same-origin' })
  if (response.status === 403) throw new UnauthorizedError()
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  return response
}
