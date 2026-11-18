import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedRequests } from '../logic/sharedRequests'

export interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  /** Runs the request again with the same key; a shared one sends a new request rather than take a kept answer. */
  retry: () => void
}

export interface RequestOptions {
  /**
   * Shares the request under its key with every caller on the page that shares it (`sharedRequests`):
   * one request on its way serves them all, and its answer serves those that come later for this many
   * ms (0: only while it's on its way). The key then names the request itself, the same for every
   * caller, and a kept answer shows at once. Without it the caller asks on its own.
   */
  freshFor?: number
}

interface Settled<T> {
  key: string
  attempt: number
  data?: T
  error?: unknown
}

/**
 * Runs `load` whenever `key` changes (null skips it) and aborts the previous run, so a slow
 * response for an old key never overwrites a newer one. `load` passes the signal on to its requests,
 * so an aborted one is cancelled rather than only ignored (a shared one once no other caller waits
 * for it), and may change between renders.
 */
export function useRequest<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, options: RequestOptions = {}): RequestState<T> {
  const { freshFor } = options
  const loadRef = useRef(load)
  // Retries count per key, from 0 again when the key changes, so a key's first run takes a shared
  // answer and a retry renews it.
  const [retries, setRetries] = useState({ key, count: 0 })
  if (retries.key !== key) setRetries({ key, count: 0 })
  const attempt = retries.key === key ? retries.count : 0
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    const run =
      freshFor === undefined
        ? loadRef.current(controller.signal)
        : sharedRequests.get(key, (signal) => loadRef.current(signal), { freshFor, signal: controller.signal, renew: attempt > 0 })
    run.then(
      // A load can resolve after its abort (it ignored the signal, or settled some parts first).
      (data) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, error })
      },
    )
    return () => controller.abort()
  }, [key, attempt, freshFor])

  const retry = useCallback(() => setRetries((last) => ({ key: last.key, count: last.count + 1 })), [])
  const own = settled && settled.key === key && settled.attempt === attempt ? settled : null
  // A shared answer kept fresh shows from the first render, not after a loading one.
  const kept = own === null && key !== null && freshFor !== undefined && attempt === 0 ? sharedRequests.peek<T>(key, freshFor) : undefined
  const current = own ?? (kept ? { data: kept.data, error: undefined } : null)

  return {
    data: current?.data,
    error: current?.error,
    loading: key !== null && current === null,
    retry,
  }
}
