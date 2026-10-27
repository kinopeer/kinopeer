import { useLayoutEffect, useState } from 'react'
import { cx } from '../lib/cx'

interface ReleaseNameProps {
  name: string
  className?: string
}

/**
 * A release's name, clipped to two lines. When it doesn't fit, it's a button that shows the whole
 * name; when it fits, plain text, so nothing looks clickable for no reason. Before the browser has
 * laid it out (and in jsdom, where nothing has a size) it counts as clipped.
 */
export function ReleaseName({ name, className }: ReleaseNameProps) {
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(true)
  // The element is state, not a ref: it's remounted when it changes between a button and a span.
  const [element, setElement] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!element || expanded) return
    const measure = () => setClipped(element.clientHeight === 0 || element.scrollHeight > element.clientHeight)
    measure()
    // The web font may arrive after the first layout and change where the lines break.
    void document.fonts?.ready.then(measure)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, expanded, name])

  const classes = cx('t-label rel-name', !expanded && 'ks-clamp2', className)
  if (!clipped && !expanded) {
    return (
      <span ref={setElement} className={classes}>
        {name}
      </span>
    )
  }
  return (
    <button ref={setElement} type="button" className={classes} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {name}
    </button>
  )
}
