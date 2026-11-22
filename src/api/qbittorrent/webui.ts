// qBittorrent's calls only the WebUI build makes, straight to qBittorrent on the page's origin. Kept
// apart from ./client.ts, whose every call goes through Kinopeer's bridge too and is checked to pass
// it (EVERY_CALL in server/integration/qbittorrent.test.ts); the bridge forwards none of these.
import { withTimeout } from '../../logic/withTimeout'
import { QbittorrentError } from './errors'
import { WEBUI_BASE } from './transport'

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
