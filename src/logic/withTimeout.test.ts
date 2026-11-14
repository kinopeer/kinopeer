import { describe, expect, it } from 'vitest'
import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
  it('hands request a signal that is aborted at once when the caller already gave up', async () => {
    const caller = new AbortController()
    caller.abort()
    const seen = await withTimeout(60_000, caller.signal, async (signal) => signal.aborted)
    expect(seen).toBe(true)
  })

  it('hands request a live signal that follows the caller afterwards', async () => {
    const caller = new AbortController()
    let attempt: AbortSignal | undefined
    const done = withTimeout(60_000, caller.signal, (signal) => {
      attempt = signal
      return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    expect(attempt?.aborted).toBe(false)
    caller.abort()
    await expect(done).rejects.toThrow('aborted')
    expect(attempt?.aborted).toBe(true)
  })

  it('aborts the attempt after the time', async () => {
    const caller = new AbortController()
    await expect(
      withTimeout(5, caller.signal, (signal) => new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('late'))))),
    ).rejects.toThrow('late')
    expect(caller.signal.aborted).toBe(false)
  })
})
