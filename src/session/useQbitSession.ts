import { useCallback, useEffect, useState } from 'react'
import { NoAddressError, UnauthorizedError, unreachable, type Unreachable } from '../api/qbittorrent'
import { checkAppVersion } from '../api/sharedAnswers'
import { saveQbittorrentLogin, type ServerSettings } from '../api/settings'
import { isSupportedVersion } from '../torrents/qbittorrentVersion'

export type QbitSession =
  | { status: 'checking' }
  /** The server's login works, or qBittorrent skips auth for it (localhost / whitelisted subnet). */
  | { status: 'connected'; version: string }
  /** qBittorrent answered, but it's older than Kinopeer works with (`MIN_QBITTORRENT_VERSION`). */
  | { status: 'unsupported'; version: string }
  /** The server has no working qBittorrent login: the app asks for one. */
  | { status: 'signed-out' }
  /** The server has no address for qBittorrent, from its environment or the app: the app asks for one. */
  | { status: 'no-address' }
  /** The check got no answer: from Kinopeer's server (or the way to it) or from qBittorrent behind it. */
  | { status: 'unreachable'; who: Unreachable }

async function probe(): Promise<QbitSession> {
  try {
    const version = await checkAppVersion()
    return isSupportedVersion(version) ? { status: 'connected', version } : { status: 'unsupported', version }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { status: 'signed-out' }
    if (error instanceof NoAddressError) return { status: 'no-address' }
    return { status: 'unreachable', who: unreachable(error) }
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
