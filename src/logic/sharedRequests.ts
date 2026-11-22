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
  /** Keeps an answer the app got otherwise, such as a save that answers with what it saved, and tells the key's followers. */
  set: <T>(key: string, data: T) => void
  /**
   * Calls `listener` with each answer `set` keeps for the key from now on, so a caller that shows the
   * key's answer follows a save sent from elsewhere (a Settings left and opened again); until the returned call.
   */
  follow: <T>(key: string, listener: (data: T) => void) => () => void
  /** Forgets everything kept and cancels what's on its way (tests); followers stay. */
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
  /** The callers waiting that can give up and haven't; read only while the request is on its way. */
  waiting: number
  /** Someone waits who can't give up (no signal), which keeps the request going. */
  held?: boolean
  /** When the answer came, while it's kept. */
  settledAt?: number
  data?: unknown
}

export function createSharedRequests(now: () => number = () => Date.now()): SharedRequests {
  const entries = new Map<string, Entry>()
  const followers = new Map<string, Set<(data: unknown) => void>>()

  const start = (key: string, load: (signal: AbortSignal) => Promise<unknown>): Entry => {
    const controller = new AbortController()
    const entry: Entry = { promise: Promise.resolve(), controller, waiting: 0 }
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
    entries.set(key, entry)
    return entry
  }

  /** The caller's wait on an entry, which it gives up with its signal. */
  const wait = <T>(key: string, entry: Entry, signal: AbortSignal | undefined): Promise<T> => {
    if (!signal) {
      entry.held = true
      return entry.promise as Promise<T>
    }
    entry.waiting += 1
    return new Promise<T>((resolve, reject) => {
      const leave = () => {
        reject(signal.reason)
        entry.waiting -= 1
        // The last one waiting for a request on its way cancels it, and the key forgets it.
        if (entry.waiting === 0 && !entry.held && entry.settledAt === undefined) {
          entry.controller.abort()
          if (entries.get(key) === entry) entries.delete(key)
        }
      }
      // An abort after the answer only rejects a settled wait, which does nothing.
      signal.addEventListener('abort', leave)
      void entry.promise.then((data) => resolve(data as T), reject)
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
      entries.set(key, { promise: Promise.resolve(data), controller: new AbortController(), waiting: 0, settledAt: now(), data })
      followers.get(key)?.forEach((listener) => listener(data))
    },
    follow: <T>(key: string, listener: (data: T) => void) => {
      const follower = listener as (data: unknown) => void
      // A key's set stays once empty: the keys followed are a few.
      followers.set(key, (followers.get(key) ?? new Set()).add(follower))
      return () => void followers.get(key)?.delete(follower)
    },
    clear: () => {
      // Followers stay: they're the mounted callers', which leave by themselves.
      // Aborting a settled request's controller does nothing.
      for (const entry of entries.values()) entry.controller.abort()
      entries.clear()
    },
  }
}

/** The page's shared requests. */
export const sharedRequests = createSharedRequests()
