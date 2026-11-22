// qBittorrent's calls only the WebUI build makes, straight to qBittorrent on the page's origin. Kept
// apart from ./client.ts, whose every call goes through Kinopeer's bridge too and is checked to pass
// it (EVERY_CALL in server/integration/qbittorrent.test.ts); the bridge forwards none of these.
import { withTimeout } from '../../logic/withTimeout'
import { QbittorrentError } from './errors'
import { WEBUI_BASE, webuiTransport } from './transport'

/** How long a login waits for qBittorrent's answer before it gives up, so the form can be sent again. */
export const LOGIN_TIMEOUT_MS = 15_000

/** What qBittorrent said to a login: in, a wrong username or password, or this address banned after too many. */
export type LogInResult = 'ok' | 'invalid' | 'banned'

/**
 * Logs the browser in to qBittorrent, which then keeps its session in a cookie of its own (`SID`,
 * HttpOnly) for every later call (`webuiTransport`). qBittorrent answers a wrong login 401 from 5.3
 * and 200 "Fails." before, and 403 once it has banned the address. Throws `QbittorrentError` for any
 * other refusal; anything else it throws means qBittorrent didn't answer: fetch's TypeError, or the
 * abort after `LOGIN_TIMEOUT_MS`.
 */
export async function logIn(username: string, password: string): Promise<LogInResult> {
  const [response, text] = await withTimeout(LOGIN_TIMEOUT_MS, new AbortController().signal, async (signal) => {
    const answer = await fetch(`${WEBUI_BASE}/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username, password }),
      credentials: 'same-origin',
      signal,
    })
    // The body too: an answer whose body stops coming is given up as well.
    return [answer, (await answer.text()).trim()] as const
  })
  if (response.status === 401 || (response.ok && text === 'Fails.')) return 'invalid'
  if (response.status === 403) return 'banned'
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  return 'ok'
}

/**
 * What qBittorrent keeps for its web interfaces in `clientdata` (5.2+), shared by every browser that
 * signs in to it and by qBittorrent's own interface, so Kinopeer's keys take a `kinopeer.` prefix.
 * Values are any JSON; the whole store holds 1 MiB (1,048,576 bytes), every interface's keys together.
 */
export type ClientData = Record<string, unknown>

/**
 * How long a `clientdata` call waits for qBittorrent's answer, its body included, before it gives up,
 * so a qBittorrent that took the connection and stopped answering doesn't keep a form busy, as with
 * `LOGIN_TIMEOUT_MS`.
 */
export const CLIENT_DATA_TIMEOUT_MS = 15_000

/** The values of `keys` that qBittorrent keeps; a key it doesn't keep isn't in the answer. */
export async function loadClientData(keys: readonly string[], signal = new AbortController().signal): Promise<ClientData> {
  const data: unknown = await withTimeout(CLIENT_DATA_TIMEOUT_MS, signal, async (attempt) => {
    const response = await webuiTransport(`/clientdata/load?${new URLSearchParams({ keys: JSON.stringify(keys) })}`, { method: 'GET', signal: attempt })
    return response.json()
  })
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as ClientData) : {}
}

/**
 * Merges `data` into qBittorrent's store key by key: the keys sent replace their values, a null
 * removes its key, and every other key stays, so two browsers saving different keys don't overwrite
 * each other. qBittorrent refuses the whole call with 409 when the store would hold more than
 * 1 MiB (`isStoreFull`), and keeps nothing of it.
 */
export async function storeClientData(data: ClientData): Promise<void> {
  await withTimeout(CLIENT_DATA_TIMEOUT_MS, new AbortController().signal, (signal) =>
    webuiTransport('/clientdata/store', { method: 'POST', body: new URLSearchParams({ data: JSON.stringify(data) }), signal }),
  )
}

/** qBittorrent refused a `storeClientData` because its store would be over 1 MiB. */
export function isStoreFull(error: unknown): boolean {
  return error instanceof QbittorrentError && error.status === 409
}
