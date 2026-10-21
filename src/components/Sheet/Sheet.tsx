import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import './Sheet.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Next to the title, e.g. a Reset button. */
  action?: ReactNode
  /** Pinned under the scrolling content, e.g. the primary button. */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Bottom sheet on a native modal <dialog>: focus moves in and stays there, Escape and a tap on the
 * backdrop close it, and focus returns to what opened it.
 */
export function Sheet({ open, onClose, title, action, footer, className, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

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
      className={cx('ks-sheet', className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
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
          <div className="ks-grabber" aria-hidden="true" />
          <div className="ks-sheet-head">
            <h2 id={titleId} className="t-h3">
              {title}
            </h2>
            {action}
          </div>
          <div className="ks-sheet-body">{children}</div>
          {footer && <div className="ks-sheet-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
