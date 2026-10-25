import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
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

/**
 * Bottom sheet on a native modal <dialog>, a centered modal on desktop: focus moves in and stays
 * there, Escape and a tap on the backdrop close it, and focus returns to what opened it.
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
          <div className="ks-sheet-body">{children}</div>
          {footer && <div className="ks-sheet-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
