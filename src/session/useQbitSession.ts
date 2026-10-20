import { useCallback, useEffect, useState } from 'react'
import { UnauthorizedError, getAppVersion, login, logout } from '../api/qbittorrent'

export type QbitSession =
  | { status: 'checking' }
  /** Session is valid, or qBittorrent skips auth for this client (localhost / whitelisted subnet). */
  | { status: 'connected'; version: string }
  | { status: 'signed-out' }
  /** qBittorrent or the proxy did not answer. */
  | { status: 'unreachable' }

async function probe(): Promise<QbitSession> {
  try {
    return { status: 'connected', version: await getAppVersion() }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { status: 'signed-out' }
    return { status: 'unreachable' }
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

  /** Throws the client's typed errors so the form can show them; resolves once the session works. */
  const signIn = useCallback(async (username: string, password: string) => {
    await login(username, password)
    const next = await probe()
    setSession(next)
    if (next.status !== 'connected') throw new UnauthorizedError()
  }, [])

  const signOut = useCallback(async () => {
    await logout().catch(() => {})
    setSession({ status: 'signed-out' })
  }, [])

  return { session, recheck, signIn, signOut }
}
