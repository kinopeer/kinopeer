import { useCallback, useEffect, useState } from 'react'
import { failureOf, type ConnectionFailure } from '../api/connectionFailure'
import { NoAddressError, UnauthorizedError, unreachable, type Unreachable } from '../api/qbittorrent'
import type { SourceAddress } from '../api/settings'
import { checkAppVersion } from '../api/sharedAnswers'
import { saveQbittorrentLogin, type ServerSettings } from '../api/settings'
import { MIN_QBITTORRENT_VERSION, MIN_WEBUI_QBITTORRENT_VERSION, isSupportedVersion } from '../torrents/qbittorrentVersion'

export type QbitSession =
  | { status: 'checking' }
  /**
   * The server's login works, or qBittorrent skips auth for it (localhost / whitelisted subnet); in
   * the WebUI build, the browser's own session with qBittorrent, or its auth bypass for the browser.
   */
  | { status: 'connected'; version: string }
  /** qBittorrent answered, but it's older than Kinopeer works with (`MIN_QBITTORRENT_VERSION`). */
  | { status: 'unsupported'; version: string }
  /** The server has no working qBittorrent login, or in the WebUI build the browser has no session: the app asks for one. */
  | { status: 'signed-out'; source?: SourceAddress }
  /** The server has no address for qBittorrent, from its environment or the app: the app asks for one. */
  | { status: 'no-address' }
  /**
   * The check got no answer: from Kinopeer's server (or the way to it) or from qBittorrent behind
   * it, with why qBittorrent didn't answer where the server could tell.
   */
  | { status: 'unreachable'; who: Unreachable; failure?: ConnectionFailure }

/** The oldest qBittorrent this build works with: the WebUI build keeps its settings in qBittorrent's `clientdata` (5.2). */
export function requiredQbittorrentVersion(): string {
  return __WEBUI__ ? MIN_WEBUI_QBITTORRENT_VERSION : MIN_QBITTORRENT_VERSION
}

async function probe(): Promise<QbitSession> {
  try {
    const version = await checkAppVersion()
    return isSupportedVersion(version, requiredQbittorrentVersion()) ? { status: 'connected', version } : { status: 'unsupported', version }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { status: 'signed-out', source: error.source }
    if (error instanceof NoAddressError) return { status: 'no-address' }
    return { status: 'unreachable', who: unreachable(error), failure: failureOf(error) }
  }
}

export function useQbitSession() {
  const [session, setSession] = useState<QbitSession>({ status: 'checking' })

  const recheck = useCallback(async () => {
    setSession({ status: 'checking' })
    setSession(await probe())
  }, [])

  useEffect(() => {
    let cancelled = false
    void probe().then((next) => {
      if (!cancelled) setSession(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Saves the login on the server, which keeps it, and with `url` qBittorrent's address. Throws its
   * SettingsError so the form can show why; resolves with the server's settings once qBittorrent
   * answers, also when its version is too old, which the app then says. Settings saves through it
   * too, so the app's session follows a new address: its version, or that it's too old.
   */
  const signIn = useCallback(async (username: string, password: string, url?: string): Promise<ServerSettings> => {
    const settings = await saveQbittorrentLogin(username, password, url)
    const next = await probe()
    setSession(next)
    if (next.status !== 'connected' && next.status !== 'unsupported') throw new UnauthorizedError()
    return settings
  }, [])

  return { session, recheck, signIn }
}
