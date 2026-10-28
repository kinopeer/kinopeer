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
/** A flick down at least this fast (px/ms) closes it however short it was. */
const CLOSE_SPEED = 0.5
/** Ms without a move before letting go after which the flick no longer counts. */
const FLICK_WINDOW = 100

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
    if (open && !dialog.open) {
      // Where a drag left it, from the last time it was open.
      exit.current?.cancel()
      exit.current = null
      dialog.style.transform = ''
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
    if ((event.target as Element).closest('button, a, input')) return
    // The opening slide animates transform too and would hide the drag until it ends.
    if (ref.current?.getAnimations?.().some((animation) => animation.playState === 'running')) return
    drag.current = { pointerId: event.pointerId, startY: event.clientY, y: event.clientY, time: event.timeStamp, speed: 0 }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (ref.current) ref.current.style.transition = 'none'
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
    if (event.type === 'pointerup' && distance > 0 && (far || current.speed >= CLOSE_SPEED)) {
      slideOut(dialog)
      return
    }
    dialog.style.transition = 'transform var(--d-base) var(--ease)'
    dialog.style.transform = ''
  }

  /** Finishes the swipe off the screen, then closes; the open effect puts it back next time. */
  const slideOut = (dialog: HTMLDialogElement) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof dialog.animate !== 'function') {
      onClose()
      return
    }
    const style = getComputedStyle(dialog)
    exit.current = dialog.animate([{ transform: dialog.style.transform }, { transform: 'translateY(100%)' }], {
      duration: parseFloat(style.getPropertyValue('--d-base')) || 200,
      easing: style.getPropertyValue('--ease-in') || 'ease-in',
      fill: 'forwards',
    })
    const animation = exit.current
    // Closed another way meanwhile (Escape, the backdrop) or opened again: not this slide's to close.
    animation.finished.then(() => {
      if (exit.current === animation && dialog.open) onClose()
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
