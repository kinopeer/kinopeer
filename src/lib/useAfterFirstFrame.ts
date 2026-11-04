import { useEffect, useState } from 'react'

/**
 * Whether the content for `key` has been on the page for a whole frame: false while `key` is
 * undefined, and from each change of `key` until the frame after the next one starts, by when the
 * browser has laid that content out and painted it once. A list waits for it before it lets the
 * browser skip its rows off screen (`content-visibility: auto`): a row laid out in full once keeps
 * that height while skipped (`contain-intrinsic-size: auto`), rather than an estimate.
 */
export function useAfterFirstFrame(key: string | undefined): boolean {
  const [frame, setFrame] = useState({ key, passed: false })
  // A new key starts over, an undefined one in between too: its content is new to the page.
  if (frame.key !== key) setFrame({ key, passed: false })

  useEffect(() => {
    if (key === undefined) return
    // The first callback runs before the next frame, which may be the one that lays the content out
    // when this effect ran before the paint; the second runs once that frame is done.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setFrame({ key, passed: true }))
    })
    return () => cancelAnimationFrame(id)
  }, [key])

  return frame.passed
}
