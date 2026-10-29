import { opensKeyboard } from './keyboardInset'

/** Where a field goes while Safari decides whether to scroll to it: far above the page's top. */
const OUT_OF_VIEW = 'translateY(-2000px)'

let holds = 0
let stop: (() => void) | null = null

/**
 * Keeps the page behind an open modal still on a touch screen. `overflow: hidden` on <html>
 * (base.css) stops a finger on the page, but with the on-screen keyboard open iOS Safari still
 * scrolls it: focusing a field scrolls the page to it, although the sheet already sits above the
 * keyboard (`trackKeyboardInset`), and a swipe that nothing in the modal scrolls pans the page. So,
 * until every hold is released:
 *
 * - a swipe that starts outside anything that scrolls, or on something that has nothing to scroll,
 *   doesn't move the page;
 * - a field that opens the keyboard moves far above the page's top for the frame in which it gets
 *   focus, so Safari scrolls nothing to show it; then it's brought into view in its own scroller
 *   (the sheet's body), once the keyboard has opened;
 * - if the page scrolls anyway, it goes back.
 *
 * Returns a function that releases this hold. Not under a mouse, like base.css.
 */
export function holdPage(view: Window = window): () => void {
  if (!view.matchMedia?.('(pointer: coarse)').matches) return () => {}
  if (holds++ === 0) stop = start(view)
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holds > 0) return
    stop?.()
    stop = null
  }
}

function start(view: Window): () => void {
  const doc = view.document
  const viewport = view.visualViewport
  const { scrollX, scrollY } = view
  let scroller: Element | null = null
  let field: HTMLElement | null = null

  const onTouchStart = (event: TouchEvent) => {
    scroller = scrollerOf(event.target, view)
  }
  const onTouchMove = (event: TouchEvent) => {
    // `overscroll-behavior: contain` keeps a swipe to its scroller only while it has something to
    // scroll; otherwise the swipe goes on to the page.
    if (!scroller || !overflows(scroller)) event.preventDefault()
  }
  const reveal = () => {
    if (field && doc.activeElement === field) bringIntoView(field, view)
  }
  const onFocus = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !opensKeyboard(target)) return
    field = target
    const transform = target.style.transform
    target.style.transform = OUT_OF_VIEW
    view.requestAnimationFrame(() => {
      target.style.transform = transform
      reveal()
    })
  }
  const onScroll = () => view.scrollTo(scrollX, scrollY)

  doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  doc.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  doc.addEventListener('focus', onFocus, true)
  view.addEventListener('scroll', onScroll)
  // The keyboard opening shrinks the sheet, which can hide the field again.
  viewport?.addEventListener('resize', reveal)
  return () => {
    doc.removeEventListener('touchstart', onTouchStart, { capture: true })
    doc.removeEventListener('touchmove', onTouchMove, { capture: true })
    doc.removeEventListener('focus', onFocus, true)
    view.removeEventListener('scroll', onScroll)
    viewport?.removeEventListener('resize', reveal)
  }
}

/** The nearest element from the target up that scrolls its content, or null. */
function scrollerOf(target: EventTarget | null, view: Window): Element | null {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    const { overflowX, overflowY } = view.getComputedStyle(node)
    if (/auto|scroll/.test(overflowY) || /auto|scroll/.test(overflowX)) return node
  }
  return null
}

function overflows(element: Element): boolean {
  return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
}

/** Scrolls the field's own scroller, not the page, the least that shows all of the field. */
function bringIntoView(field: HTMLElement, view: Window) {
  const scroller = scrollerOf(field.parentElement, view)
  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  const rect = field.getBoundingClientRect()
  if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top
  else if (rect.bottom > box.bottom) scroller.scrollTop += Math.min(rect.bottom - box.bottom, rect.top - box.top)
}
