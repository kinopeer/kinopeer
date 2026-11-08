import type { Matches, MatchesPatch } from './types'
import { fetchKinopeer } from '../fetchKinopeer'

/** Torrent-to-title matches the Kinopeer server keeps (server/matches.ts). */
export const MATCHES_BASE = '/api/matches'

export class MatchesError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Matches request failed (${status})`)
    this.name = 'MatchesError'
    this.status = status
  }
}

async function read(response: Response): Promise<Matches> {
  // No JSON: a server without /api/matches (the SPA fallback answered).
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new MatchesError(response.status)
  }
  return (await response.json()) as Matches
}

export async function getMatches(signal?: AbortSignal): Promise<Matches> {
  return read(await fetchKinopeer(MATCHES_BASE, { signal }))
}

/**
 * Saves matches by info hash (null forgets one) and answers all the server has. A guess never
 * replaces the user's choice: the server keeps the choice and answers it.
 */
export async function saveMatches(matches: MatchesPatch): Promise<Matches> {
  return read(
    await fetchKinopeer(MATCHES_BASE, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matches),
    }),
  )
}

/** Forgets every guess, so browsers guess again; the user's choices stay. Answers what is left. */
export async function clearGuesses(): Promise<Matches> {
  return read(await fetchKinopeer(MATCHES_BASE, { method: 'DELETE' }))
}
