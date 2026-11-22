// qBittorrent's calls only the WebUI build makes, straight to qBittorrent on the page's origin. Kept
// apart from ./client.ts, whose every call goes through Kinopeer's bridge too and is checked to pass
// it (EVERY_CALL in server/integration/qbittorrent.test.ts); the bridge forwards none of these.
import { QbittorrentError } from './errors'
import { WEBUI_BASE } from './transport'

/** What qBittorrent said to a login: in, a wrong username or password, or this address banned after too many. */
export type LogInResult = 'ok' | 'invalid' | 'banned'

/**
 * Logs the browser in to qBittorrent, which then keeps its session in a cookie of its own (`SID`,
 * HttpOnly) for every later call (`webuiTransport`). qBittorrent answers a wrong login 401 from 5.3
 * and 200 "Fails." before, and 403 once it has banned the address. Throws `QbittorrentError` for any
 * other refusal, and fetch's TypeError when qBittorrent doesn't answer.
 */
export async function logIn(username: string, password: string): Promise<LogInResult> {
  const response = await fetch(`${WEBUI_BASE}/auth/login`, {
    method: 'POST',
    body: new URLSearchParams({ username, password }),
    credentials: 'same-origin',
  })
  const text = (await response.text()).trim()
  if (response.status === 401 || (response.ok && text === 'Fails.')) return 'invalid'
  if (response.status === 403) return 'banned'
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  return 'ok'
}
