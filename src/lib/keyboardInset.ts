export interface ViewportSize {
  /** The layout viewport's height, `innerHeight`. */
  layoutHeight: number
  /** The visual viewport's height, offset from the layout viewport's top and pinch zoom. */
  height: number
  offsetTop: number
  scale: number
}

/**
 * How much of the layout viewport's bottom the visual viewport leaves out: the on-screen keyboard's
 * height, less what the browser scrolled the page by to show the focused field. 0 under pinch zoom,
 * which also shrinks the visual viewport.
 */
export function keyboardInset({ layoutHeight, height, offsetTop, scale }: ViewportSize): number {
  if (Math.abs(scale - 1) > 0.01) return 0
  return Math.max(0, Math.round(layoutHeight - offsetTop - height))
}

/**
 * Keeps `--keyboard-inset` on <html> at the height the on-screen keyboard covers, so a sheet at the
 * bottom of the screen sits above it. iOS Safari shrinks only the visual viewport when the keyboard
 * opens, so `bottom: 0` and `100dvh` stay behind it; a browser that shrinks the layout viewport
 * instead (Chrome on Android) leaves it unset. Returns a function that stops it.
 */
export function trackKeyboardInset(view: Window = window): () => void {
  const viewport = view.visualViewport
  const root = view.document.documentElement
  if (!viewport) return () => {}
  const update = () => {
    const inset = keyboardInset({
      layoutHeight: view.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale,
    })
    if (inset > 0) root.style.setProperty('--keyboard-inset', `${inset}px`)
    else root.style.removeProperty('--keyboard-inset')
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    root.style.removeProperty('--keyboard-inset')
  }
}
