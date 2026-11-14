import { useEffect, useSyncExternalStore } from 'react'
import type { Matches } from '../api/matches'
import { currentServerMatches, loadServerMatches, subscribeServerMatches } from './serverMatches'

/**
 * The server's matches by info hash; undefined until they load. When the server doesn't answer
 * they are empty, so the caller goes on without them.
 */
export function useServerMatches(): Matches | undefined {
  useEffect(() => {
    loadServerMatches()
  }, [])
  return useSyncExternalStore(subscribeServerMatches, currentServerMatches)
}
