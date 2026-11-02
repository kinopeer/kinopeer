import { keyboardArea, opensKeyboard } from './keyboardInset'

/** Where a field goes while Safari decides whether to scroll to it: far above the page's top. */
const OUT_OF_VIEW = 'translateY(-2000px)'

/**
 * How long a field stays out of view when focus moves to it with the keyboard already open and no
 * tap on it (the keyboard's previous and next buttons): Safari centers such a field a moment after
 * focus, not at it (40-60 ms in the iOS Simulator), so a frame isn't enough.
 */
const NAVIGATION_HOLD_MS = 100

/** How far a finger moves before its swipe has a direction, in pixels, like a sheet's drag. */
const SLOP = 4

/**
 * Where the window sits during a hold, in pixels. Not the very top: going there brings Safari's
 * collapsed toolbar back, which shrinks the viewport under an open sheet.
 */
const PINNED_AT = 1

type Axis = 'x' | 'y'

let holds = 0
let current: { stop: () => void; pinAhead: () => void } | null = null
/**
 * Keeps the page behind an open modal still on a touch screen. `overflow: hidden` on <html>
 * (base.css) stops a finger on the page, but with the on-screen keyboard open iOS Safari still
 * scrolls it: focusing a field scrolls the page to it, although the sheet already sits above the
 * keyboard (`trackKeyboardInset`), and a swipe that nothing in the modal scrolls pans the page. So,
 * until every hold is released:
 *
 * - a swipe moves the page only through a box under the finger that has more to show along the
 *   swipe (the sheet's body, a row of chips across); two fingers still zoom;
 * - a field that opens the keyboard moves far above the page's top for the frame in which it gets
 *   focus, so Safari scrolls nothing to show it (for `NAVIGATION_HOLD_MS` when the keyboard's
 *   arrows moved focus there); then it's brought into view in its own scroller (the sheet's body),
 *   once the keyboard has opened;
 * - from the moment a modal with such a field opens, the window sits by the top (`PINNED_AT`) and
 *   the body's negative margin keeps the page where it was: on a page scrolled further, opening the
 *   keyboard takes the window to the top in Safari whatever a sheet's field is, and scrolling back
 *   from there leaves the layout viewport behind, up by the keyboard's height, with sticky bars and
 *   the backdrop in it. Doing this when a field gets focus, with the page and the sheet in place
 *   until then, made them jump on a phone, likely because the margin reached the screen before the
 *   scroll did. With the keyboard already open over the page, or a field that came later, it waits
 *   for the field's focus. A modal with no such field leaves the page alone: nothing opens the
 *   keyboard, and a link in it leaves the page's real place for the browser to bring back;
 * - if the page scrolls anyway, it goes back to where the hold keeps it, so nothing may scroll the
 *   page on purpose while a modal is open.
 *
 * `modal` is the modal being opened, with its contents committed. Returns a function that releases
 * this hold. Not under a mouse, like base.css.
 */
export function holdPage(modal?: Element | null, view: Window = window): () => void {
  if (!view.matchMedia?.('(pointer: coarse)').matches) return () => {}
  if (holds++ === 0) current = start(view)
  if (modal && Array.from(modal.querySelectorAll('input, textarea')).some(opensKeyboard)) current?.pinAhead()
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holds > 0) return
    current?.stop()
    current = null
  }
}

function start(view: Window) {
  const doc = view.document
  const viewport = view.visualViewport
  const { scrollX, scrollY } = view
  // Where the window goes back to if it scrolls.
  let top = scrollY
  let unpin: (() => void) | null = null
  let touch: { x: number; y: number; target: EventTarget | null } | null = null
  let scrolls: boolean | null = null
  let field: HTMLElement | null = null
  // What the last finger went down on, until it moves off as a swipe or a focus reads it.
  let tapped: EventTarget | null = null

  const onTouchStart = (event: TouchEvent) => {
    // The first finger's, which goes on swiping after a pinch.
    const first = event.touches[0]
    touch = first ? { x: first.clientX, y: first.clientY, target: first.target ?? event.target } : null
    scrolls = null
    tapped = event.target
  }
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) return
    const first = event.touches[0]
    // A finger that was already down when the hold began.
    if (!touch || !first) return event.preventDefault()
    if (scrolls === null) {
      const dx = first.clientX - touch.x
      const dy = first.clientY - touch.y
      // Too short to have a direction yet: the page moves under it only if nothing could scroll.
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
        if (!scrollerOf(touch.target, 'x', view) && !scrollerOf(touch.target, 'y', view)) event.preventDefault()
        return
      }
      tapped = null
      // Decided once per swipe, along the way it first went.
      scrolls = scrollerOf(touch.target, Math.abs(dx) > Math.abs(dy) ? 'x' : 'y', view) !== null
    }
    if (!scrolls) event.preventDefault()
  }
  const keyboardOpen = () =>
    !!viewport &&
    !!keyboardArea({
      layoutHeight: view.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale,
    })
  const reveal = () => {
    // Out of view, it would be measured 2000px up; the end of the hold reveals it.
    if (field && doc.activeElement === field && field.style.transform !== OUT_OF_VIEW) bringIntoView(field, view)
  }
  const pin = () => {
    if (unpin || scrollY <= 0) return
    const { marginTop } = doc.body.style
    top = PINNED_AT
    doc.body.style.marginTop = `${PINNED_AT - scrollY}px`
    view.scrollTo(scrollX, PINNED_AT)
    unpin = () => {
      doc.body.style.marginTop = marginTop
      view.scrollTo(scrollX, scrollY)
    }
  }
  const onFocus = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !opensKeyboard(target)) return
    pin()
    field = target
    const byTap = tapped instanceof Node && target.contains(tapped)
    tapped = null
    // Focused again before the frame that puts it back: that frame still has its own transform.
    if (target.style.transform === OUT_OF_VIEW) return
    const transform = target.style.transform
    target.style.transform = OUT_OF_VIEW
    const back = () => {
      target.style.transform = transform
      reveal()
    }
    if (keyboardOpen() && !byTap) view.setTimeout(back, NAVIGATION_HOLD_MS)
    else view.requestAnimationFrame(back)
  }
  const onScroll = () => view.scrollTo(scrollX, top)

  doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  doc.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  doc.addEventListener('focus', onFocus, true)
  view.addEventListener('scroll', onScroll)
  // The keyboard opening shrinks the sheet, which can hide the field again.
  viewport?.addEventListener('resize', reveal)
  // Its focus came before this hold: StrictMode's second effect run, after showModal focused it.
  const focused = doc.activeElement
  if (focused instanceof HTMLElement && opensKeyboard(focused)) field = focused
  return {
    stop() {
      doc.removeEventListener('touchstart', onTouchStart, { capture: true })
      doc.removeEventListener('touchmove', onTouchMove, { capture: true })
      doc.removeEventListener('focus', onFocus, true)
      view.removeEventListener('scroll', onScroll)
      viewport?.removeEventListener('resize', reveal)
      unpin?.()
    },
    pinAhead() {
      if (!keyboardOpen()) pin()
    },
  }
}

/** The nearest element from the target up that scrolls along the axis and has more to show. */
function scrollerOf(target: EventTarget | null, axis: Axis, view: Window): Element | null {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    const { overflowX, overflowY } = view.getComputedStyle(node)
    if (/auto|scroll/.test(axis === 'x' ? overflowX : overflowY) && overflows(node, axis)) return node
  }
  return null
}

function overflows(element: Element, axis: Axis): boolean {
  return axis === 'x' ? element.scrollWidth > element.clientWidth : element.scrollHeight > element.clientHeight
}

/** Scrolls the field's own scroller, not the page, the least that shows all of the field. */
function bringIntoView(field: HTMLElement, view: Window) {
  const scroller = scrollerOf(field.parentElement, 'y', view)
  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  const rect = field.getBoundingClientRect()
  if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top
  // A field taller than the box keeps its top in view.
  else if (rect.bottom > box.bottom) scroller.scrollTop += Math.min(rect.bottom - box.bottom, rect.top - box.top)
}
