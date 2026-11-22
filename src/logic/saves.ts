// Saves sent from Settings' sheets, which outlive the sheet that sent them: the user may close it,
// or leave Settings, while the request is on its way. One save per kind and target is in flight at a
// time, every sheet that opens for it meanwhile shows what's sent, and its outcome goes to the
// sheets that take it when it settles, else the caller says it elsewhere (a toast). The torrent
// requests (`createTorrentRequests`) do the same for torrents; this one has no torrent, poll or
// expected state, so a target is any string.

export type SaveOutcome<Result = unknown> = { ok: true; result: Result } | { ok: false; error: unknown }

/** How a save settled, and whether a sheet took the outcome (else the caller says it). */
export type SaveSettled<Result> = SaveOutcome<Result> & { taken: boolean }

/** Something that may take the outcome of the saves of a kind, as a sheet does while it shows their target. */
export interface SaveWatcher {
  /** A save for `target` settled, having sent `sent`: whether this takes its outcome. */
  settled: (outcome: SaveOutcome, sent: unknown, target: string) => boolean
}

/** What's being sent, by `saveKey`. Replaced, never changed, so it can be a snapshot. */
export type SavesInFlight = ReadonlyMap<string, unknown>

export interface Saves {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SavesInFlight
  /**
   * Sends a save of a kind for a target and says how it settled; with one of that kind already in
   * flight for the target, nothing is sent and it says nothing, so a save never goes out twice.
   */
  send: <Result>(kind: string, target: string, payload: unknown, request: () => Promise<Result>) => Promise<SaveSettled<Result> | undefined>
  /** Offers `watcher` the outcome of each save of a kind as it settles. */
  watch: (kind: string, watcher: SaveWatcher) => () => void
  /** Forgets what's in flight and who watches (tests), telling no one. */
  clear: () => void
}

export const saveKey = (kind: string, target: string) => `${kind}|${target}`

export function createSaves(): Saves {
  let inFlight: SavesInFlight = new Map()
  const listeners = new Set<() => void>()
  const watchers = new Map<string, Set<SaveWatcher>>()

  const update = (change: (next: Map<string, unknown>) => void) => {
    const next = new Map(inFlight)
    change(next)
    inFlight = next
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => inFlight,
    async send(kind, target, payload, request) {
      const key = saveKey(kind, target)
      if (inFlight.has(key)) return undefined
      update((next) => next.set(key, payload))
      let outcome: SaveOutcome<Awaited<ReturnType<typeof request>>>
      try {
        outcome = { ok: true, result: await request() }
      } catch (error) {
        outcome = { ok: false, error }
      }
      update((next) => next.delete(key))
      // Each is offered it, even once one took it: two sheets may show the same target.
      let taken = false
      for (const watcher of [...(watchers.get(kind) ?? [])]) if (watcher.settled(outcome, payload, target)) taken = true
      return { ...outcome, taken }
    },
    watch(kind, watcher) {
      const ofKind = watchers.get(kind) ?? new Set()
      watchers.set(kind, ofKind.add(watcher))
      // A kind's set stays once empty: the kinds are a few names.
      return () => {
        ofKind.delete(watcher)
      }
    },
    clear() {
      inFlight = new Map()
      watchers.clear()
    },
  }
}

/** The page's saves, shared by every screen, so a save outlives Settings and shows in it opened again. */
export const saves = createSaves()
