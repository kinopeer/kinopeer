/**
 * Runs `request` with a signal that aborts with `signal` or after `ms`, so a request that stalls
 * (a connection that stops answering, a body that stops coming) is given up and rejects, as long as
 * it passes the signal on.
 */
export async function withTimeout<T>(ms: number, signal: AbortSignal, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const attempt = new AbortController()
  const abort = () => attempt.abort()
  signal.addEventListener('abort', abort)
  const timer = setTimeout(abort, ms)
  try {
    return await request(attempt.signal)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
