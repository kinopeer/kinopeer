import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFrames } from '../test/frames'
import { useAfterFirstFrame } from './useAfterFirstFrame'

let nextFrame: () => void
let pending: () => number

beforeEach(() => {
  ;({ nextFrame, pending } = stubFrames())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAfterFirstFrame', () => {
  it('turns true once the frame after the next one starts, by when the content was laid out', () => {
    const { result } = renderHook(() => useAfterFirstFrame('list'))
    expect(result.current).toBe(false)

    // The next frame may be the one that lays the content out, when the effect ran before the paint.
    nextFrame()
    expect(result.current).toBe(false)

    nextFrame()
    expect(result.current).toBe(true)
  })

  it('stays false without a key, and asks for no frame', () => {
    const { result } = renderHook(() => useAfterFirstFrame(undefined))
    expect(pending()).toBe(0)
    expect(result.current).toBe(false)
  })

  it('starts over for a new key, false at once, since the content is new to the page', () => {
    const { result, rerender } = renderHook(({ key }) => useAfterFirstFrame(key), { initialProps: { key: 'list' } })
    nextFrame()
    nextFrame()
    expect(result.current).toBe(true)

    rerender({ key: 'grid' })
    expect(result.current).toBe(false)
    nextFrame()
    expect(result.current).toBe(false)
    nextFrame()
    expect(result.current).toBe(true)
  })

  it('starts over when the same key comes back after none', () => {
    const { result, rerender } = renderHook(({ key }) => useAfterFirstFrame(key), {
      initialProps: { key: 'list' } as { key?: string },
    })
    nextFrame()
    nextFrame()
    expect(result.current).toBe(true)

    rerender({ key: undefined })
    expect(result.current).toBe(false)

    // The rows of a filter that matched nothing are back: new elements, not laid out yet.
    rerender({ key: 'list' })
    expect(result.current).toBe(false)
    nextFrame()
    nextFrame()
    expect(result.current).toBe(true)
  })

  it('asks for no frame once it’s gone', () => {
    const { unmount } = renderHook(() => useAfterFirstFrame('list'))
    unmount()
    expect(pending()).toBe(0)
  })
})
