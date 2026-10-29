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

const PROPERTIES = ['--keyboard-inset', '--visible-top', '--visible-height']

/**
 * While the on-screen keyboard is open, keeps on <html> where the part of the page above it is:
 * `--keyboard-inset` (from the layout viewport's bottom), `--visible-top` and `--visible-height`, so
 * a sheet sits in it. Safari on iOS and Chrome on Android open the keyboard over the page and
 * shrink only the visual viewport, so `bottom: 0` and `100dvh` stay behind it. Returns a function
 * that stops it.
 */
export function trackKeyboardInset(view: Window = window): () => void {
  const viewport = view.visualViewport
  const root = view.document.documentElement
  if (!viewport) return () => {}
  const clear = () => PROPERTIES.forEach((property) => root.style.removeProperty(property))
  const update = () => {
    const inset = keyboardInset({
      layoutHeight: view.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale,
    })
    if (inset === 0) return clear()
    root.style.setProperty('--keyboard-inset', `${inset}px`)
    root.style.setProperty('--visible-top', `${Math.round(viewport.offsetTop)}px`)
    root.style.setProperty('--visible-height', `${Math.floor(viewport.height)}px`)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    clear()
  }
}
