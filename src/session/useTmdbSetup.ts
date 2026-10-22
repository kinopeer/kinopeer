import { useCallback, useEffect, useState } from 'react'
import { getServerSettings } from '../api/settings'

/** 'needed': the server has no TMDB key yet, so onboarding asks for one. */
export type TmdbSetup = 'checking' | 'needed' | 'done'

/**
 * Whether onboarding should ask for the TMDB key, checked once qBittorrent is connected. A server
 * that can't say (an older build) never blocks the app.
 */
export function useTmdbSetup(enabled: boolean) {
  const [setup, setSetup] = useState<TmdbSetup>('checking')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getServerSettings()
      .then((settings) => (settings.tmdb.configured ? 'done' : 'needed'))
      .catch(() => 'done' as const)
      .then((next) => {
        if (!cancelled) setSetup(next)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const finish = useCallback(() => setSetup('done'), [])
  return { setup, finish }
}
