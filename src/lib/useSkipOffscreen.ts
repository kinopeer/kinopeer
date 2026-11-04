import { useLayoutEffect, useMemo, useState } from 'react'
import { useAfterFirstFrame } from './useAfterFirstFrame'

/**
 * Whether a list's rows may be skipped off screen yet (`content-visibility: auto`), and the ref for
 * the list's container, whose width it watches. A skipped row keeps the height it had when it was
 * last laid out (`contain-intrinsic-size: auto`), so the rows go unskipped for a frame
 * (`useAfterFirstFrame`) whenever that height may be wrong or missing: in another layout (`layout`,
 * undefined while there are no rows), at another width (a phone turned, a window resized), and when
 * the rows shown change (`ids`), since a row shown again, as when a filter is undone, is a new
 * element. A row that only moves, as in another sort, keeps its height.
 */
export function useSkipOffscreen(
  layout: string | undefined,
  ids: readonly string[],
): { ref: (element: HTMLElement | null) => void; skip: boolean } {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number>()

  useLayoutEffect(() => {
    if (!element) return
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width))
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [element])

  // In any order: what matters is which rows are there.
  const rows = useMemo(() => [...ids].sort().join('\n'), [ids])
  const skip = useAfterFirstFrame(layout === undefined ? undefined : `${layout} ${width}\n${rows}`)
  return { ref: setElement, skip }
}
