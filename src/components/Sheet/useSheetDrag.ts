import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent, type RefObject } from 'react'
import { shouldClose } from './sheetDrag'

/** What a pointer-down in the title row leaves alone: its controls keep their taps. */
const CONTROLS = 'button, a, input, select, textarea, label, summary, [role]'
/** Px a pointer moves before it's a drag rather than a press (a long-press still selects text). */
const DRAG_SLOP = 4
/** Ms of moves the release speed is measured over, so one jittery pair of events isn't a flick. */
const SPEED_WINDOW = 80

interface Drag {
  pointerId: number
  /** Where the pointer went down, for the slop. */
  downY: number
  /** Where a drag from the sheet's resting place would have started (the sheet may be mid-spring). */
  startY: number
  y: number
  time: number
  /** The moves within the last SPEED_WINDOW ms, oldest first. */
  samples: { y: number; time: number }[]
  /** Moved past the slop: selection is off and any started selection is cleared. */
  moving: boolean
}
type Handler = (event: PointerEvent<HTMLElement>) => void

export interface SheetDrag {
  /** For the handle. */
  handle: {
    onPointerDown: Handler
    onPointerMove: Handler
    onPointerUp: Handler
    onPointerCancel: Handler
    onLostPointerCapture: Handler
    onDragStart: (event: DragEvent<HTMLElement>) => void
  }
  /** For the dialog: a new press forgets the last drag. */
  onPointerDownCapture: () => void
  /**
   * Whether a click is the end of a drag rather than a tap: a drag let go over the backdrop can end
   * in a click on the dialog itself, which would read as a tap on the backdrop.
   */
  endsDrag: () => boolean
}

/**
 * Dragging a sheet down by its handle: the drag follows the finger inline, the spring back is the
 * stylesheet's transition and the slide off the screen a Web Animation of the same length, after
 * which `onClose` runs. A parent that keeps the sheet open (its next render still has `open`) gets
 * it back in view. So `onClose` closes it with a plain state update, as every caller does: one that
 * closes later (in a transition, after an await) sees it come back before it goes.
 */
export function useSheetDrag(
  ref: RefObject<HTMLDialogElement | null>,
  { open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean },
): SheetDrag {
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)
  const exit = useRef<Animation | null>(null)
  const [closeAsked, setCloseAsked] = useState(0)
  // The slide ends a transition after the pointer-up: the parent's callback by then, not that render's.
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  /** Back where it opens, with any slide dropped and the stylesheet's transition. */
  const putBack = (dialog: HTMLDialogElement) => {
    exit.current?.cancel()
    exit.current = null
    dialog.style.transform = ''
    dialog.style.transition = ''
  }

  useEffect(() => {
    // A drag the sheet closed under (a second finger tapped Done) never got its end event.
    drag.current = null
    const dialog = ref.current
    // Where a drag left it, from the last time it was open.
    if (open && dialog) putBack(dialog)
  }, [open, ref])

  // An unmounted sheet's slide must not close whatever opens next.
  useEffect(() => () => exit.current?.cancel(), [])

  // The render after `onClose`: a parent that closed the sheet has `open` false by now, as its update
  // and this one land together. One that kept it open (busy) gets it back instead of an invisible
  // modal holding the page.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (closeAsked && open && dialog) putBack(dialog)
  }, [closeAsked, open, ref])

  const end = (handle: HTMLElement) => handle.classList.remove('is-dragging')

  const onPointerDown: Handler = (event) => {
    // A sheet already sliding out is on its way to closing.
    if (!enabled || drag.current || exit.current || event.button !== 0) return
    const control = (event.target as Element).closest(CONTROLS)
    if (control && event.currentTarget.contains(control)) return
    const dialog = ref.current
    if (!dialog) return
    // Where it is now, also partway through the opening slide or a spring back.
    const offset = currentOffset(dialog)
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // The pointer is already gone: without the capture its end could land anywhere and never come.
      return
    }
    // The opening slide (a CSS animation) animates transform too and would hide the drag until it
    // ends, so the drag takes over from where it has got to. A spring back (a CSS transition) gives
    // way to the inline transform by itself.
    for (const animation of dialog.getAnimations?.() ?? []) {
      if (isCssAnimation(animation) && animation.playState === 'running') animation.finish()
    }
    drag.current = {
      pointerId: event.pointerId,
      downY: event.clientY,
      startY: event.clientY - offset,
      y: event.clientY,
      time: event.timeStamp,
      samples: [{ y: event.clientY, time: event.timeStamp }],
      moving: false,
    }
    dialog.style.transition = 'none'
    if (offset > 0) dialog.style.transform = `translateY(${offset}px)`
  }

  const onPointerMove: Handler = (event) => {
    const current = drag.current
    const dialog = ref.current
    if (!current || !dialog || event.pointerId !== current.pointerId) return
    if (!current.moving && Math.abs(event.clientY - current.downY) >= DRAG_SLOP) {
      current.moving = true
      event.currentTarget.classList.add('is-dragging')
      window.getSelection?.()?.removeAllRanges()
    }
    current.samples.push({ y: event.clientY, time: event.timeStamp })
    while (current.samples.length > 2 && event.timeStamp - current.samples[0].time > SPEED_WINDOW) current.samples.shift()
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
    dragged.current = current.moving
    end(event.currentTarget)
    const release = {
      distance: current.y - current.startY,
      speed: speedOf(current.samples),
      idle: event.timeStamp - current.time,
      height: dialog.offsetHeight,
    }
    // A press that never moved is a tap, even on a sheet caught partway down its spring back.
    if (event.type === 'pointerup' && current.moving && shouldClose(release)) {
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
      askToClose()
      return
    }
    exit.current = animation
    // Closed another way meanwhile (Escape, the backdrop) or opened again: not this slide's to close.
    animation.finished.then(() => {
      if (exit.current !== animation || !dialog.open) return
      askToClose()
    }, () => {})
  }

  const askToClose = () => {
    close.current()
    setCloseAsked((count) => count + 1)
  }

  return {
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
      // An image in the title row (a poster) would start the browser's own drag and cancel this one.
      onDragStart: (event) => event.preventDefault(),
    },
    onPointerDownCapture: () => {
      dragged.current = false
    },
    endsDrag: () => {
      const was = dragged.current
      dragged.current = false
      return was
    },
  }
}

/** The slide off the screen, or null where there are no Web Animations or the browser refuses it. */
function slide(dialog: HTMLDialogElement): Animation | null {
  if (typeof dialog.animate !== 'function') return null
  const style = getComputedStyle(dialog)
  try {
    return dialog.animate([{ transform: dialog.style.transform }, { transform: 'translateY(100%)' }], {
      // As long as the spring back: the sheet's own transition, which the browser reports in seconds
      // whatever unit the token uses, and which reduced motion already cuts to almost nothing.
      duration: transformDuration(style),
      easing: style.getPropertyValue('--ease-in').trim() || 'ease-in',
      fill: 'forwards',
    })
  } catch {
    // An easing or a duration the browser can't take: close without the slide rather than hang
    // halfway down.
    return null
  }
}

/**
 * Ms of the stylesheet's transition on transform: the duration in the same place in the list as
 * `transform` (or `all`) in the properties, else the first.
 */
function transformDuration(style: CSSStyleDeclaration): number {
  const properties = style.transitionProperty.split(',').map((property) => property.trim())
  const durations = style.transitionDuration.split(',')
  const index = Math.max(0, properties.findIndex((property) => property === 'transform' || property === 'all'))
  return parseFloat(durations[index % durations.length]) * 1000
}

/** Px/ms down over the samples kept: from the oldest to the newest. */
function speedOf(samples: Drag['samples']): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const elapsed = last.time - first.time
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0
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
