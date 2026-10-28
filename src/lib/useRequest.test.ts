import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRequest } from './useRequest'

interface Load {
  promise: Promise<string>
  resolve: (value: string) => void
  reject: (reason: unknown) => void
}

function load(): Load {
  const result = {} as Load
  result.promise = new Promise<string>((resolve, reject) => Object.assign(result, { resolve, reject }))
  return result
}

describe('useRequest', () => {
  it('loads per key and ignores responses for an old key', async () => {
    const resolvers: Record<string, (value: string) => void> = {}
    const signals: AbortSignal[] = []
    const { result, rerender } = renderHook(({ key }) =>
      useRequest(key, (signal) => {
        signals.push(signal)
        return new Promise<string>((resolve) => (resolvers[key] = resolve))
      }),
      { initialProps: { key: 'a' } },
    )
    expect(result.current.loading).toBe(true)

    rerender({ key: 'b' })
    expect(signals[0].aborted).toBe(true)
    await act(async () => resolvers.a('stale'))
    expect(result.current.data).toBeUndefined()

    await act(async () => resolvers.b('fresh'))
    expect(result.current).toMatchObject({ data: 'fresh', loading: false })
  })

  it.each(['resolves', 'rejects'] as const)("keeps the new key's data when the old key's load %s after it", async (late) => {
    const loads: Record<string, Load> = {}
    const { result, rerender } = renderHook(({ key }) =>
      useRequest(key, () => (loads[key] = load()).promise),
      { initialProps: { key: 'a' } },
    )
    rerender({ key: 'b' })

    await act(async () => loads.b.resolve('fresh'))
    await act(async () => (late === 'resolves' ? loads.a.resolve('stale') : loads.a.reject(new Error('stale'))))
    expect(result.current).toMatchObject({ data: 'fresh', error: undefined, loading: false })
  })

  it.each(['resolves', 'rejects'] as const)("keeps a retry's data when the attempt before it %s after it", async (late) => {
    const loads: Load[] = []
    const { result } = renderHook(() =>
      useRequest('k', () => {
        loads.push(load())
        return loads[loads.length - 1].promise
      }),
    )
    act(() => result.current.retry())

    await act(async () => loads[1].resolve('fresh'))
    await act(async () => (late === 'resolves' ? loads[0].resolve('stale') : loads[0].reject(new Error('stale'))))
    expect(result.current).toMatchObject({ data: 'fresh', error: undefined, loading: false })
  })

  it('drops a load that resolves after its key went away, so the key loads afresh when it comes back', async () => {
    const resolvers: ((value: string) => void)[] = []
    const { result, rerender } = renderHook(({ key }: { key: string | null }) =>
      useRequest(key, () => new Promise<string>((resolve) => resolvers.push(resolve))),
      { initialProps: { key: 'a' as string | null } },
    )
    rerender({ key: null })
    // An aborted load can still resolve, e.g. Promise.allSettled with the parts done before the abort.
    await act(async () => resolvers[0]('partial'))

    rerender({ key: 'a' })
    expect(result.current).toMatchObject({ data: undefined, loading: true })
    await act(async () => resolvers[1]('whole'))
    expect(result.current).toMatchObject({ data: 'whole', loading: false })
  })

  it('skips a null key', () => {
    const load = vi.fn()
    const { result } = renderHook(() => useRequest(null, load))
    expect(load).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('reports errors and retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    const { result } = renderHook(() => useRequest('k', load))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))

    act(() => result.current.retry())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('ok'))
    expect(result.current.error).toBeUndefined()
  })
})
