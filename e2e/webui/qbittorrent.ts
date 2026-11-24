/**
 * The test side of the WebUI stand (scripts/test-smoke-webui.sh, docs/TESTING.md → The WebUI's
 * smoke journeys): a real qBittorrent in Docker serving `npm run build:webui` as its Alternative
 * WebUI, with the login of qBittorrent.conf beside this file. The journeys drive the page in
 * Chromium and read and reset qBittorrent through its own Web API from Node, as another client.
 */

/**
 * Where the journeys reach qBittorrent: its name on the stand's Docker network, at the port it
 * listens on inside its container, since qBittorrent's Host header validation refuses another port.
 * An origin of a name with one label is private, as a LAN address is.
 */
export const QBITTORRENT_URL = 'http://qbittorrent:8080'

/** The login qBittorrent.conf sets (its hash is of this password). */
export const LOGIN = { username: 'admin', password: 'pass word' }

/** The torrent the stand adds, stopped, so Downloads has something to show. */
export const SEEDED_NAME = 'Shogun.S01.2160p'
/** Its info hash, made up: qBittorrent never fetches its metadata. */
export const SEEDED_HASH = '5'.repeat(40)

/** Signs in to qBittorrent from Node and returns its session cookie. */
async function signIn(): Promise<string> {
  const response = await fetch(`${QBITTORRENT_URL}/api/v2/auth/login`, {
    method: 'POST',
    body: new URLSearchParams(LOGIN),
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!response.ok || !cookie) throw new Error(`qBittorrent refused the stand's login: ${response.status}`)
  return cookie
}

async function call(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${QBITTORRENT_URL}/api/v2${path}`, { ...init, headers: { Cookie: cookie } })
  if (!response.ok) throw new Error(`qBittorrent answered ${path} with ${response.status}: ${await response.text()}`)
  return response
}

/** Waits for qBittorrent to answer (a 403 without a session counts), up to a minute. */
export async function waitForQbittorrent(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await fetch(`${QBITTORRENT_URL}/api/v2/app/version`)
      return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`qBittorrent did not answer at ${QBITTORRENT_URL}`)
}

/**
 * Adds a magnet link named as a release, stopped, to the stand's fresh qBittorrent: qBittorrent
 * lists it by the link's name while it has no metadata, which it never fetches, stopped.
 */
export async function seedTorrent(): Promise<void> {
  const cookie = await signIn()
  const magnet = `magnet:?xt=urn:btih:${SEEDED_HASH}&dn=${SEEDED_NAME}`
  await call(cookie, '/torrents/add', { method: 'POST', body: new URLSearchParams({ urls: magnet, stopped: 'true' }) })
}

/** Everything qBittorrent keeps in `clientdata`, every interface's keys. */
export async function clientData(): Promise<Record<string, unknown>> {
  const cookie = await signIn()
  return (await (await call(cookie, '/clientdata/load')).json()) as Record<string, unknown>
}

const kinopeerKeys = (data: Record<string, unknown>) => Object.keys(data).filter((key) => key.startsWith('kinopeer.'))

/**
 * Removes Kinopeer's keys from `clientdata`, a null each, so each journey starts as a first visit,
 * and reads the store back to see them gone.
 */
export async function resetClientData(): Promise<void> {
  const cookie = await signIn()
  const load = async () => (await (await call(cookie, '/clientdata/load')).json()) as Record<string, unknown>
  const keys = kinopeerKeys(await load())
  if (keys.length === 0) return
  const removed = Object.fromEntries(keys.map((key) => [key, null]))
  await call(cookie, '/clientdata/store', { method: 'POST', body: new URLSearchParams({ data: JSON.stringify(removed) }) })
  const left = kinopeerKeys(await load())
  if (left.length > 0) throw new Error(`qBittorrent kept ${left.join(', ')} after a null`)
}

/** qBittorrent's Alternative WebUI as its preferences say: on or off, and the folder it names. */
export async function alternativeWebui(): Promise<{ enabled: unknown; path: unknown }> {
  const cookie = await signIn()
  const preferences = (await (await call(cookie, '/app/preferences')).json()) as Record<string, unknown>
  return { enabled: preferences.alternative_webui_enabled, path: preferences.alternative_webui_path }
}

/** Turns qBittorrent's Alternative WebUI back on, as qBittorrent.conf has it, for the journeys after one that turned it off. */
export async function enableAlternativeWebui(): Promise<void> {
  const cookie = await signIn()
  await call(cookie, '/app/setPreferences', { method: 'POST', body: new URLSearchParams({ json: JSON.stringify({ alternative_webui_enabled: true }) }) })
}
