import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { useIsDesktop } from '../../lib/useIsDesktop'
import './Sheet.css'
import { useSheetDrag } from './useSheetDrag'

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
  // On desktop it's a centered modal with no grabber.
  const isDesktop = useIsDesktop()
  const drag = useSheetDrag(ref, { open, onClose, enabled: !isDesktop })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // jsdom has no showModal; the open attribute is enough there.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

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
      onPointerDownCapture={drag.onPointerDownCapture}
      onClick={(event) => {
        // Pointer Events 3 sends the click after a captured drag to the handle, but a browser that
        // predates it sends it to where the press and the release meet, which can be the dialog.
        // Chromium follows the spec; Safari is unverified, so this stays.
        if (drag.endsDrag()) return
        // A click on the dialog box itself, outside its content, is a click on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="ks-sheet-inner">
          <div className="ks-sheet-handle" {...drag.handle}>
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
