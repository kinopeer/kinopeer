// Requests shared by key across the page: callers that ask for the same key while one request is on
// its way get its answer, and later callers get that answer while it's as fresh as they ask for.
// `useRequest` reads it with its `freshFor` option, and code outside React (the settings' load) calls
// it directly. Only answers are kept: a failure is for the callers that waited for it, and the next
// one asks again.

/** What a caller asks of a shared request. */
export interface ShareOptions {
  /** How old an answer, in ms, the caller takes instead of asking again; 0 takes only one on its way. */
  freshFor: number
  /** Gives up waiting; the request itself is cancelled once no one else waits for it. */
  signal?: AbortSignal
  /** Sends a new request whatever is kept or on its way, as a retry does; its answer replaces the kept one. */
  renew?: boolean
}

export interface SharedRequests {
  /** The key's answer: one on its way, else a fresh enough kept one, else a new request's. */
  get: <T>(key: string, load: (signal: AbortSignal) => Promise<T>, options: ShareOptions) => Promise<T>
  /** A kept answer fresh enough for `freshFor`, for a caller that renders it without waiting. */
  peek: <T>(key: string, freshFor: number) => { data: T } | undefined
  /** Keeps an answer the app got otherwise, such as a save that answers with what it saved. */
  set: <T>(key: string, data: T) => void
  /** Forgets everything kept and cancels what's on its way (tests). */
  clear: () => void
}

/**
 * Whether an answer kept since `settledAt` is fresh at `now` for a caller that takes `freshFor` ms.
 * An answer from the future, the clock having been set back since, isn't: its age can't be told.
 */
export function isFresh(settledAt: number, now: number, freshFor: number): boolean {
  return now >= settledAt && now - settledAt < freshFor
}

interface Entry {
  promise: Promise<unknown>
  controller: AbortController
  /** The callers waiting that can give up; one that can't keeps the request going. */
  waiting: number
  /** Someone waits who can't give up (no signal). */
  held: boolean
  /** When the answer came, while it's kept. */
  settledAt?: number
  data?: unknown
}

export function createSharedRequests(now: () => number = () => Date.now()): SharedRequests {
  const entries = new Map<string, Entry>()

  const start = (key: string, load: (signal: AbortSignal) => Promise<unknown>): Entry => {
    const controller = new AbortController()
    const entry: Entry = { promise: Promise.resolve(), controller, waiting: 0, held: false }
    entry.promise = load(controller.signal).then(
      (data) => {
        entry.settledAt = now()
        entry.data = data
        return data
      },
      (error: unknown) => {
        // Only answers are kept; a newer request under the key stays.
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      },
    )
    // A rejection is for the callers; one with no caller left mustn't be reported as unhandled.
    entry.promise.catch(() => {})
    entries.set(key, entry)
    return entry
  }

  /** The caller's wait on an entry, which it gives up with its signal. */
  const wait = <T>(key: string, entry: Entry, signal: AbortSignal | undefined): Promise<T> => {
    if (!signal) {
      entry.held = true
      return entry.promise as Promise<T>
    }
    if (signal.aborted) return Promise.reject(signal.reason)
    entry.waiting += 1
    return new Promise<T>((resolve, reject) => {
      // Once, whichever comes first: the caller giving up or the request settling.
      let done = false
      const finish = (settle: () => void) => {
        if (done) return
        done = true
        entry.waiting -= 1
        signal.removeEventListener('abort', leave)
        settle()
      }
      const leave = () =>
        finish(() => {
          reject(signal.reason)
          // The last one waiting for a request on its way cancels it, and the key forgets it.
          if (entry.waiting === 0 && !entry.held && entry.settledAt === undefined) {
            entry.controller.abort()
            if (entries.get(key) === entry) entries.delete(key)
          }
        })
      signal.addEventListener('abort', leave)
      entry.promise.then(
        (data) => finish(() => resolve(data as T)),
        (error: unknown) => finish(() => reject(error)),
      )
    })
  }

  const kept = (key: string, freshFor: number): Entry | undefined => {
    const entry = entries.get(key)
    if (entry?.settledAt === undefined) return undefined
    return isFresh(entry.settledAt, now(), freshFor) ? entry : undefined
  }

  return {
    get: <T>(key: string, load: (signal: AbortSignal) => Promise<T>, { freshFor, signal, renew = false }: ShareOptions) => {
      if (signal?.aborted) return Promise.reject(signal.reason)
      const entry = entries.get(key)
      const onItsWay = entry !== undefined && entry.settledAt === undefined
      const reused = renew ? undefined : onItsWay ? entry : kept(key, freshFor)
      return wait<T>(key, reused ?? start(key, load), signal)
    },
    peek: <T>(key: string, freshFor: number) => {
      const entry = kept(key, freshFor)
      return entry ? { data: entry.data as T } : undefined
    },
    set: (key, data) => {
      entries.set(key, { promise: Promise.resolve(data), controller: new AbortController(), waiting: 0, held: false, settledAt: now(), data })
    },
    clear: () => {
      for (const entry of entries.values()) if (entry.settledAt === undefined) entry.controller.abort()
      entries.clear()
    },
  }
}

/** The page's shared requests. */
export const sharedRequests = createSharedRequests()
