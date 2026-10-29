export interface ViewportSize {
  /** The layout viewport's height, `innerHeight`. */
  layoutHeight: number
  /** The visual viewport's height, offset from the layout viewport's top and pinch zoom. */
  height: number
  offsetTop: number
  scale: number
}

/** The part of the page above the on-screen keyboard, in the layout viewport's pixels. */
export interface KeyboardArea {
  /** From the layout viewport's bottom to the area's: the keyboard's height, less what the browser
   *  scrolled the page by to show the focused field (0 once it scrolled to the page's end). */
  inset: number
  top: number
  height: number
}

/**
 * Where the page shows above the on-screen keyboard, or null without one: the visual viewport is as
 * tall as the layout viewport, or pinch zoom shrank it instead.
 */
export function keyboardArea({ layoutHeight, height, offsetTop, scale }: ViewportSize): KeyboardArea | null {
  if (Math.abs(scale - 1) > 0.01) return null
  if (Math.round(layoutHeight - height) <= 0) return null
  return {
    inset: Math.max(0, Math.round(layoutHeight - offsetTop - height)),
    top: Math.round(offsetTop),
    height: Math.floor(height),
  }
}

const PROPERTIES = ['--keyboard-inset', '--visible-top', '--visible-height', '--keyboard-open']

/** Inputs that take a tap, not typing, so focusing one closes the keyboard. */
const UNTYPED = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** Whether focus on this element keeps the on-screen keyboard open. */
export function opensKeyboard(element: Element | null): boolean {
  if (element?.tagName === 'TEXTAREA') return true
  return element?.tagName === 'INPUT' && !UNTYPED.has((element as HTMLInputElement).type)
}

/**
 * While the on-screen keyboard is open, keeps on <html> where the part of the page above it is:
 * `--keyboard-inset` (from the layout viewport's bottom), `--visible-top` and `--visible-height`, so
 * a sheet sits in it, and `--keyboard-open` (1), so it can keep its distance. Safari on iOS and Chrome on Android open the keyboard over the page and
 * shrink only the visual viewport, so `bottom: 0` and `100dvh` stay behind it. Returns a function
 * that stops it.
 *
 * The keyboard is open only while a field has focus, and Safari reports its new size only once it
 * has slid away, so the area goes as soon as focus leaves the field, together with the keyboard.
 */
export function trackKeyboardInset(view: Window = window): () => void {
  const viewport = view.visualViewport
  const doc = view.document
  const root = doc.documentElement
  if (!viewport) return () => {}
  const clear = () => PROPERTIES.forEach((property) => root.style.removeProperty(property))
  const update = () => {
    const area = keyboardArea({
      layoutHeight: view.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale,
    })
    if (!area || !opensKeyboard(doc.activeElement)) return clear()
    root.style.setProperty('--keyboard-inset', `${area.inset}px`)
    root.style.setProperty('--visible-top', `${area.top}px`)
    root.style.setProperty('--visible-height', `${area.height}px`)
    root.style.setProperty('--keyboard-open', '1')
  }
  // Moving from one field to the next sends both in one task, so the sheet doesn't move in between.
  doc.addEventListener('focusout', clear)
  doc.addEventListener('focusin', update)
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()
  return () => {
    doc.removeEventListener('focusout', clear)
    doc.removeEventListener('focusin', update)
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    clear()
  }
}
