import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRequest } from './useRequest'

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
