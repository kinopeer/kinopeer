import { useLayoutEffect, useState } from 'react'

/**
 * Keeps an element's height in a CSS custom property on its parent, for what has to know it in
 * CSS: e.g. a table's column names that stick under a sticky header whose height varies. Returns
 * the ref callback for the element; the property goes with it.
 */
export function useHeightVar(name: string): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const target = element?.parentElement
    if (!element || !target) return
    const update = () => target.style.setProperty(name, `${element.getBoundingClientRect().height}px`)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      target.style.removeProperty(name)
    }
  }, [element, name])

  return setElement
}
