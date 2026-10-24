import { useEffect, useSyncExternalStore } from 'react'
import { clearGuesses, getMatches, saveMatches, type Matches } from '../api/matches'

/**
 * The torrent-to-title matches the Kinoseed server keeps (server/matches.ts), shared by every
 * screen: loaded once, then kept current with what this browser saves. Another device's changes
 * show after a reload.
 */
let matches: Matches | undefined
let loading = false
let failedAt: number | undefined
// Bumped by resetServerMatches, so a load from before it is ignored.
let generation = 0
const listeners = new Set<() => void>()

// When the server didn't answer, the next screen that needs the matches asks again after this.
const RETRY_MS = 60_000
// Guesses are saved in batches: the first visit to a long list guesses many at once.
const SAVE_DELAY_MS = 1_000
const SAVE_BATCH = 500

let pending: Matches = {}
let saveTimer: ReturnType<typeof setTimeout> | undefined
// What this page already tried to save, so a failing server isn't asked again on every poll.
const attempted = new Set<string>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function load(): void {
  if (loading) return
  loading = true
  const started = generation
  getMatches().then(
    (loaded) => {
      if (started !== generation) return
      matches = loaded
      failedAt = undefined
    },
    () => {
      if (started !== generation) return
      // Matching still works without the server, guessing in this browser only.
      matches ??= {}
      failedAt = Date.now()
    },
  ).finally(() => {
    if (started !== generation) return
    loading = false
    emit()
  })
}

/**
 * The server's matches by info hash; undefined until they load. When the server doesn't answer
 * they are empty, so the caller goes on without them.
 */
export function useServerMatches(): Matches | undefined {
  useEffect(() => {
    if (matches === undefined || (failedAt !== undefined && Date.now() - failedAt > RETRY_MS)) load()
  }, [])
  return useSyncExternalStore(subscribe, () => matches)
}

async function save(): Promise<void> {
  saveTimer = undefined
  const entries = Object.entries(pending)
  pending = {}
  for (let start = 0; start < entries.length; start += SAVE_BATCH) {
    try {
      matches = await saveMatches(Object.fromEntries(entries.slice(start, start + SAVE_BATCH)))
      failedAt = undefined
      emit()
    } catch {
      // They stay in this browser's cache; the next page load tries again.
      return
    }
  }
}

/** Saves matches on the server, unless it already has them or this page tried already. */
export function rememberMatches(changes: Matches): void {
  for (const [hash, match] of Object.entries(changes)) {
    const key = `${hash}|${match.source}:${match.type}:${match.id}:${match.version ?? ''}`
    const kept = matches?.[hash]
    if (kept && key === `${hash}|${kept.source}:${kept.type}:${kept.id}:${kept.version ?? ''}`) continue
    if (attempted.has(key)) continue
    attempted.add(key)
    pending[hash] = match
  }
  if (Object.keys(pending).length > 0) saveTimer ??= setTimeout(() => void save(), SAVE_DELAY_MS)
}

/** Forgets the matches of deleted torrents; if the server doesn't answer, its hourly check does. */
export async function forgetMatches(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return
  for (const hash of hashes) {
    delete pending[hash]
    for (const key of attempted) if (key.startsWith(`${hash}|`)) attempted.delete(key)
  }
  try {
    matches = await saveMatches(Object.fromEntries(hashes.map((hash) => [hash, null])))
    emit()
  } catch {
    // The server forgets them a week after qBittorrent stops listing them.
  }
}

/** Forgets the server's guesses, so they are made again; the user's choices stay. */
export async function forgetServerGuesses(): Promise<void> {
  pending = {}
  attempted.clear()
  try {
    matches = await clearGuesses()
    emit()
  } catch {
    // The server didn't answer: its guesses stay until the next try.
  }
}

/** For tests. */
export function resetServerMatches(): void {
  generation += 1
  matches = undefined
  loading = false
  failedAt = undefined
  pending = {}
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  attempted.clear()
}
