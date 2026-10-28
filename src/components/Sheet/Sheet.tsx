import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { useIsDesktop } from '../../lib/useIsDesktop'
import './Sheet.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Under the title, e.g. what the sheet is about. */
  subtitle?: string
  /** Before the title, e.g. a Back button. */
  leading?: ReactNode
  /** Next to the title, e.g. a Reset button. */
  action?: ReactNode
  /** Pinned under the scrolling content, e.g. the primary button. */
  footer?: ReactNode
  /**
   * `md` fits its content. `lg` is for long lists: full height on phones, and on desktop a wider
   * modal of a fixed height.
   */
  size?: 'md' | 'lg'
  className?: string
  children: ReactNode
}

/** How far down a let-go sheet closes: this many px, or this share of its height if that's more. */
const CLOSE_DISTANCE = 96
const CLOSE_SHARE = 0.3
/** A flick down at least this fast (px/ms) and this far (px, so a wobbly tap isn't one) closes it. */
const CLOSE_SPEED = 0.5
const FLICK_DISTANCE = 20
/** Ms without a move before letting go after which the flick no longer counts. */
const FLICK_WINDOW = 100
/** Ms after `onClose` by which a parent that closes the sheet has done so; else it comes back. */
const CLOSE_GRACE = 100
/** What a pointer-down in the title row leaves alone: its controls keep their taps. */
const CONTROLS = 'button, a, input, select, textarea, label, summary, [role]'

interface Drag {
  pointerId: number
  startY: number
  y: number
  time: number
  /** Px/ms, from the last two samples. */
  speed: number
}

/**
 * Bottom sheet on a native modal <dialog>, a centered modal on desktop: focus moves in and stays
 * there, Escape and a tap on the backdrop close it, and focus returns to what opened it. On a phone
 * its top (the grabber and the title row) also drags it down to close it.
 */
function isCssAnimation(animation: Animation): boolean {
  return typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
}

/** How far down the sheet is now, e.g. partway through springing back. */
function currentOffset(dialog: HTMLDialogElement): number {
  const transform = getComputedStyle(dialog).transform
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return 0
  return Math.max(0, new DOMMatrixReadOnly(transform).m42)
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  leading,
  action,
  footer,
  size = 'md',
  className,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const isDesktop = useIsDesktop()
  const drag = useRef<Drag | null>(null)
  const exit = useRef<Animation | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // A drag the sheet closed under (a second finger tapped Done) never got its end event.
    drag.current = null
    if (open && !dialog.open) {
      // Where a drag left it, from the last time it was open.
      exit.current?.cancel()
      exit.current = null
      dialog.style.transform = ''
      dialog.style.transition = ''
      // jsdom has no showModal; the open attribute is enough there.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  // An unmounted sheet's slide must not close whatever opens next.
  useEffect(() => () => exit.current?.cancel(), [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // On desktop it's a centered modal with no grabber; the title row's buttons keep their taps; a
    // sheet already sliding out is on its way to closing.
    if (isDesktop || drag.current || exit.current || event.button !== 0) return
    if ((event.target as Element).closest(CONTROLS)) return
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
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dialog.style.transition = 'none'
    if (offset > 0) dialog.style.transform = `translateY(${offset}px)`
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    const dialog = ref.current
    if (!current || !dialog || event.pointerId !== current.pointerId) return
    const elapsed = event.timeStamp - current.time
    if (elapsed > 0) current.speed = (event.clientY - current.y) / elapsed
    current.y = event.clientY
    current.time = event.timeStamp
    dialog.style.transform = `translateY(${Math.max(0, current.y - current.startY)}px)`
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    const dialog = ref.current
    if (!current || !dialog || event.pointerId !== current.pointerId) return
    drag.current = null
    // Held still before letting go: no move came to say the flick had stopped.
    if (event.timeStamp - current.time > FLICK_WINDOW) current.speed = 0
    const distance = current.y - current.startY
    const far = distance >= Math.max(CLOSE_DISTANCE, dialog.offsetHeight * CLOSE_SHARE)
    const flick = distance >= FLICK_DISTANCE && current.speed >= CLOSE_SPEED
    if (event.type === 'pointerup' && (far || flick)) {
      slideOut(dialog)
      return
    }
    // Back to the stylesheet's transition, which springs it back up.
    dialog.style.transition = ''
    dialog.style.transform = ''
  }

  /** Finishes the swipe off the screen, then closes; the open effect puts it back next time. */
  const slideOut = (dialog: HTMLDialogElement) => {
    if (typeof dialog.animate !== 'function') {
      onClose()
      return
    }
    dialog.style.transition = ''
    const style = getComputedStyle(dialog)
    // As long as the spring back: the sheet's own transition, which the browser reports in seconds
    // whatever unit the token uses, and which reduced motion already cuts to almost nothing.
    const duration = parseFloat(style.transitionDuration) * 1000
    exit.current = dialog.animate([{ transform: dialog.style.transform }, { transform: 'translateY(100%)' }], {
      duration: Number.isFinite(duration) ? duration : 0,
      easing: style.getPropertyValue('--ease-in') || 'ease-in',
      fill: 'forwards',
    })
    const animation = exit.current
    // Closed another way meanwhile (Escape, the backdrop) or opened again: not this slide's to close.
    animation.finished.then(() => {
      if (exit.current !== animation || !dialog.open) return
      onClose()
      // A parent that kept it open (busy, or a navigation that didn't happen) gets it back in view,
      // rather than an invisible modal holding the page.
      setTimeout(() => {
        if (exit.current !== animation || !dialog.open) return
        animation.cancel()
        exit.current = null
        dialog.style.transform = ''
      }, CLOSE_GRACE)
    }, () => {})
  }

  return (
    <dialog
      ref={ref}
      className={cx('ks-sheet', size === 'lg' && 'ks-sheet-lg', className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // React passes cancel up its own tree, so Escape in a dialog opened from inside this one
        // would close this one too.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click on the dialog box itself, outside its content, is a click on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="ks-sheet-inner">
          <div
            className="ks-sheet-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
          >
            <div className="ks-grabber" aria-hidden="true" />
            <div className={leading ? 'ks-sheet-head has-leading' : 'ks-sheet-head'}>
              {leading}
              <div className="ks-sheet-title">
                <h2 id={titleId} className="t-h3">
                  {title}
                </h2>
                {subtitle && <div className="t-cap c3 ks-trunc">{subtitle}</div>}
              </div>
              {action}
            </div>
          </div>
          <div className="ks-sheet-body">{children}</div>
          {footer && <div className="ks-sheet-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
