import { act } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * For tests: animation frames that start only when the test says. `nextFrame` runs the callbacks
 * asked for before it, inside `act`; `cancelAnimationFrame` drops one, as the browser does. Undo with
 * vi.unstubAllGlobals().
 */
export function stubFrames(): { nextFrame: () => void; pending: () => number } {
  const frames = new Map<number, FrameRequestCallback>()
  let lastId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++lastId, callback)
    return lastId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  return {
    nextFrame: () =>
      act(() => {
        const due = [...frames.values()]
        frames.clear()
        for (const callback of due) callback(performance.now())
      }),
    pending: () => frames.size,
  }
}
