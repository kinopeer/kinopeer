import { useCallback, useEffect, useRef, useState } from 'react'

export interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  /** Runs the request again with the same key. */
  retry: () => void
}

interface Settled<T> {
  key: string
  attempt: number
  data?: T
  error?: unknown
}

/**
 * Runs `load` whenever `key` changes (null skips it) and aborts the previous run, so a slow
 * response for an old key never overwrites a newer one. `load` may change between renders.
 */
export function useRequest<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): RequestState<T> {
  const loadRef = useRef(load)
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (data) => setSettled({ key, attempt, data }),
      (error: unknown) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, error })
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = settled && settled.key === key && settled.attempt === attempt ? settled : null

  return {
    data: current?.data,
    error: current?.error,
    loading: key !== null && current === null,
    retry,
  }
}
