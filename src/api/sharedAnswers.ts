// The answers of Kinopeer's own routes that the page shares between its callers (`sharedRequests`),
// apart from the clients so a test that mocks a client's call mocks these too.
import { APP_VERSION_FRESH_MS, APP_VERSION_KEY, getAppVersion } from './qbittorrent'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, getServerSettings, type ServerSettings } from './settings'
import { sharedRequests } from '../logic/sharedRequests'

/** The server's settings, shared with every other caller on the page. */
export function getSharedServerSettings(signal?: AbortSignal): Promise<ServerSettings> {
  return sharedRequests.get(SERVER_SETTINGS_KEY, getServerSettings, { freshFor: SERVER_SETTINGS_FRESH_MS, signal })
}

/** Asks qBittorrent's version anew, as a check of the session does, and keeps the answer for the page's other callers. */
export function checkAppVersion(signal?: AbortSignal): Promise<string> {
  return sharedRequests.get(APP_VERSION_KEY, getAppVersion, { freshFor: APP_VERSION_FRESH_MS, signal, renew: true })
}
