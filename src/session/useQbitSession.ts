import { useCallback, useEffect, useState } from 'react'
import { UnauthorizedError, getAppVersion, unreachable, type Unreachable } from '../api/qbittorrent'
import { saveQbittorrentLogin } from '../api/settings'

export type QbitSession =
  | { status: 'checking' }
  /** The server's login works, or qBittorrent skips auth for it (localhost / whitelisted subnet). */
  | { status: 'connected'; version: string }
  /** The server has no working qBittorrent login: the app asks for one. */
  | { status: 'signed-out' }
  /** The check got no answer: from Kinopeer's server (or the way to it) or from qBittorrent behind it. */
  | { status: 'unreachable'; who: Unreachable }

async function probe(): Promise<QbitSession> {
  try {
    return { status: 'connected', version: await getAppVersion() }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { status: 'signed-out' }
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
   * Saves the login on the server, which keeps it. Throws its SettingsError so the form can show
   * why; resolves once qBittorrent answers.
   */
  const signIn = useCallback(async (username: string, password: string) => {
    await saveQbittorrentLogin(username, password)
    const next = await probe()
    setSession(next)
    if (next.status !== 'connected') throw new UnauthorizedError()
  }, [])

  return { session, recheck, signIn }
}
