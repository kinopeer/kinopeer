import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { shouldClose } from './sheetDrag'

/** What a pointer-down in the title row leaves alone: its controls keep their taps. */
const CONTROLS = 'button, a, input, select, textarea, label, summary, [role]'
/** Px a pointer moves before it's a drag rather than a press (a long-press still selects text). */
const DRAG_SLOP = 4

interface Drag {
  pointerId: number
  startY: number
  y: number
  time: number
  /** Px/ms, from the last two samples. */
  speed: number
  /** Moved past the slop: selection is off and any started selection is cleared. */
  moving: boolean
}

type Handler = (event: PointerEvent<HTMLElement>) => void

export interface SheetDragHandlers {
  onPointerDown: Handler
  onPointerMove: Handler
  onPointerUp: Handler
  onPointerCancel: Handler
  onLostPointerCapture: Handler
}

/**
 * Dragging a sheet down by its handle: the drag follows the finger inline, the spring back is the
 * stylesheet's transition and the slide off the screen a Web Animation of the same length, after
 * which `onClose` runs. A parent that keeps the sheet open (its next render still has `open`) gets
 * it back in view.
 */
export function useSheetDrag(
  ref: RefObject<HTMLDialogElement | null>,
  { open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean },
): SheetDragHandlers {
  const drag = useRef<Drag | null>(null)
  const exit = useRef<Animation | null>(null)
  const [closeAsked, setCloseAsked] = useState(0)

  useEffect(() => {
    // A drag the sheet closed under (a second finger tapped Done) never got its end event.
    drag.current = null
    const dialog = ref.current
    if (!open || !dialog) return
    // Where a drag left it, from the last time it was open.
    exit.current?.cancel()
    exit.current = null
    dialog.style.transform = ''
    dialog.style.transition = ''
  }, [open, ref])

  // An unmounted sheet's slide must not close whatever opens next.
  useEffect(() => () => exit.current?.cancel(), [])

  // The render after `onClose`: a parent that closed the sheet has `open` false by now, as its update
  // and this one land together. One that kept it open (busy) gets it back instead of an invisible
  // modal holding the page.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!closeAsked || !open || !exit.current || !dialog) return
    exit.current.cancel()
    exit.current = null
    dialog.style.transform = ''
  }, [closeAsked, open, ref])

  const end = (handle: HTMLElement) => handle.classList.remove('is-dragging')

  const onPointerDown: Handler = (event) => {
    // A sheet already sliding out is on its way to closing.
    if (!enabled || drag.current || exit.current || event.button !== 0) return
    const control = (event.target as Element).closest(CONTROLS)
    if (control && event.currentTarget.contains(control)) return
    const dialog = ref.current
    if (!dialog) return
    // The opening slide (a CSS animation) animates transform too and would hide the drag until it
    // ends. A spring back still running (a CSS transition) is caught where it is instead.
    const animations = dialog.getAnimations?.() ?? []
    if (animations.some((animation) => isCssAnimation(animation) && animation.playState === 'running')) return
    const offset = currentOffset(dialog)
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY - offset,
      y: event.clientY,
      time: event.timeStamp,
      speed: 0,
      moving: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dialog.style.transition = 'none'
    if (offset > 0) dialog.style.transform = `translateY(${offset}px)`
  }

  const onPointerMove: Handler = (event) => {
    const current = drag.current
    const dialog = ref.current
    if (!current || !dialog || event.pointerId !== current.pointerId) return
    if (!current.moving && Math.abs(event.clientY - current.y) >= DRAG_SLOP) {
      current.moving = true
      event.currentTarget.classList.add('is-dragging')
      window.getSelection?.()?.removeAllRanges()
    }
    const elapsed = event.timeStamp - current.time
    if (elapsed > 0) current.speed = (event.clientY - current.y) / elapsed
    current.y = event.clientY
    current.time = event.timeStamp
    dialog.style.transform = `translateY(${Math.max(0, current.y - current.startY)}px)`
  }

  const onPointerEnd: Handler = (event) => {
    const current = drag.current
    const dialog = ref.current
    // lostpointercapture bubbles: only the handle's own capture ending ends the drag.
    if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return
    if (!current || !dialog || event.pointerId !== current.pointerId) return
    drag.current = null
    end(event.currentTarget)
    const release = {
      distance: current.y - current.startY,
      speed: current.speed,
      idle: event.timeStamp - current.time,
      height: dialog.offsetHeight,
    }
    if (event.type === 'pointerup' && shouldClose(release)) {
      slideOut(dialog)
      return
    }
    // Back to the stylesheet's transition, which springs it back up.
    dialog.style.transition = ''
    dialog.style.transform = ''
  }

  /** Finishes the swipe off the screen, then closes; the open effect puts it back next time. */
  const slideOut = (dialog: HTMLDialogElement) => {
    dialog.style.transition = ''
    const animation = slide(dialog)
    if (!animation) {
      onClose()
      return
    }
    exit.current = animation
    // Closed another way meanwhile (Escape, the backdrop) or opened again: not this slide's to close.
    animation.finished.then(() => {
      if (exit.current !== animation || !dialog.open) return
      onClose()
      setCloseAsked((count) => count + 1)
    }, () => {})
  }

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd }
}

/** The slide off the screen, or null where there are no Web Animations or the browser refuses it. */
function slide(dialog: HTMLDialogElement): Animation | null {
  if (typeof dialog.animate !== 'function') return null
  const style = getComputedStyle(dialog)
  // As long as the spring back: the sheet's own transition, which the browser reports in seconds
  // whatever unit the token uses, and which reduced motion already cuts to almost nothing.
  const duration = parseFloat(style.transitionDuration) * 1000
  try {
    return dialog.animate([{ transform: dialog.style.transform }, { transform: 'translateY(100%)' }], {
      duration: Number.isFinite(duration) ? duration : 0,
      easing: style.getPropertyValue('--ease-in').trim() || 'ease-in',
      fill: 'forwards',
    })
  } catch {
    // An easing the browser can't parse: close without the slide rather than hang halfway down.
    return null
  }
}

function isCssAnimation(animation: Animation): boolean {
  return typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
}

/** How far down the sheet is now, e.g. partway through springing back. */
function currentOffset(dialog: HTMLDialogElement): number {
  const transform = getComputedStyle(dialog).transform
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return 0
  return Math.max(0, new DOMMatrixReadOnly(transform).m42)
}
