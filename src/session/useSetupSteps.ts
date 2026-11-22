import { useCallback, useEffect, useState } from 'react'
import { getSharedServerSettings } from '../api/sharedAnswers'
import type { ServerSettings } from '../api/settings'

/** An onboarding step after qBittorrent connects: the TMDB key, then Prowlarr's address and key. */
export type SetupStep = 'tmdb' | 'prowlarr'

/**
 * The steps onboarding asks, in order: the TMDB key when the server has none and its proxy is off,
 * and Prowlarr when the server has no address for it and can save one from the app, which it does
 * only behind Kinopeer's own login (an address the environment sets, or a key without one, is
 * Settings' to change). In the WebUI build: TMDB where Kinopeer's proxy doesn't answer the page and
 * no key of the user's own is kept, then Prowlarr until its address is kept.
 */
export function setupSteps(settings: ServerSettings): SetupStep[] {
  const steps: SetupStep[] = []
  if (!settings.tmdb.configured) steps.push('tmdb')
  if ((__WEBUI__ || settings.auth?.enabled) && settings.prowlarr.address.source === null) steps.push('prowlarr')
  return steps
}

/**
 * The onboarding step to show once qBittorrent is connected: 'checking' until the server says,
 * 'done' once each was saved or skipped. A skipped step is asked again on the next visit, not
 * when the session is checked again within this one. A server
 * that can't say (an older build) never blocks the app.
 */
export function useSetupSteps(enabled: boolean) {
  const [steps, setSteps] = useState<SetupStep[] | null>(null)
  const known = steps !== null

  useEffect(() => {
    // Asked once per page: a session lost and found again (a recheck, Retry) brings back no step
    // that was finished or skipped.
    if (!enabled || known) return
    let cancelled = false
    getSharedServerSettings()
      .then(setupSteps)
      .catch(() => [])
      .then((next) => {
        if (!cancelled) setSteps(next)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, known])

  const finish = useCallback((step: SetupStep) => setSteps((current) => current?.filter((each) => each !== step) ?? current), [])
  const step: SetupStep | 'checking' | 'done' = steps === null ? 'checking' : (steps[0] ?? 'done')
  return { step, finish }
}
