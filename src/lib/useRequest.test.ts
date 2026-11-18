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

describe('useRequest with freshFor', () => {
  it('shares one request between the callers of a key, and asks on its own without freshFor', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const first = renderHook(() => useRequest('k', load, { freshFor: 0 }))
    const second = renderHook(() => useRequest('k', load, { freshFor: 0 }))
    await waitFor(() => expect(second.result.current.data).toBe('answer'))
    expect(first.result.current.data).toBe('answer')
    expect(load).toHaveBeenCalledTimes(1)

    const own = vi.fn().mockResolvedValue('own')
    renderHook(() => useRequest('own', own))
    renderHook(() => useRequest('own', own))
    await waitFor(() => expect(own).toHaveBeenCalledTimes(2))
  })

  it('shows an answer kept fresh from its first render, without asking again', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const first = renderHook(() => useRequest('k', load, { freshFor: 60_000 }))
    await waitFor(() => expect(first.result.current.data).toBe('answer'))
    first.unmount()

    const renders: unknown[] = []
    renderHook(() => {
      const state = useRequest('k', load, { freshFor: 60_000 })
      renders.push({ data: state.data, loading: state.loading })
      return state
    })
    expect(renders[0]).toEqual({ data: 'answer', loading: false })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)

    // A caller that doesn't share asks on its own, the kept answer under its key notwithstanding.
    const own = vi.fn().mockResolvedValue('own')
    const unshared = renderHook(() => useRequest('k', own))
    expect(unshared.result.current).toMatchObject({ data: undefined, loading: true })
    await waitFor(() => expect(unshared.result.current.data).toBe('own'))
  })

  it('asks again on retry rather than take the kept answer', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const { result } = renderHook(() => useRequest('k', load, { freshFor: 60_000 }))
    await waitFor(() => expect(result.current.data).toBe('first'))

    act(() => result.current.retry())
    expect(result.current).toMatchObject({ data: undefined, loading: true })
    await waitFor(() => expect(result.current.data).toBe('second'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('takes the kept answer for a key it comes back to after a retry on it', async () => {
    const load = vi.fn().mockResolvedValueOnce('a1').mockResolvedValueOnce('a2').mockResolvedValueOnce('b')
    const { result, rerender } = renderHook(({ key }) => useRequest(key, load, { freshFor: 60_000 }), { initialProps: { key: 'a' } })
    await waitFor(() => expect(result.current.data).toBe('a1'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.data).toBe('a2'))

    rerender({ key: 'b' })
    await waitFor(() => expect(result.current.data).toBe('b'))
    rerender({ key: 'a' })
    expect(result.current).toMatchObject({ data: 'a2', loading: false })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('cancels a shared request only once no caller waits for it', () => {
    const signals: AbortSignal[] = []
    const load = (signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string>(() => {})
    }
    const first = renderHook(() => useRequest('k', load, { freshFor: 0 }))
    const second = renderHook(() => useRequest('k', load, { freshFor: 0 }))
    expect(signals).toHaveLength(1)
    first.unmount()
    expect(signals[0].aborted).toBe(false)
    second.unmount()
    expect(signals[0].aborted).toBe(true)
  })
})
