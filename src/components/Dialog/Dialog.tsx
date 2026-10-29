import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { holdPage } from '../../lib/holdPage'
import { Icon, type IconName } from '../Icon'
import './Dialog.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Shown in a tinted tile above the title. */
  icon?: IconName
  tone?: 'danger'
  /** The buttons, side by side under the content. */
  actions: ReactNode
  className?: string
  children?: ReactNode
}

/**
 * A centered confirmation on a native modal <dialog> with the alertdialog role: focus moves in and
 * stays there, Escape and a tap on the backdrop close it, and focus returns to what opened it.
 */
export function Dialog({ open, onClose, title, icon, tone, actions, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => (open ? holdPage() : undefined), [open])

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
      role="alertdialog"
      className={cx('ks-dialog', tone && `ks-dialog-${tone}`, className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // React passes cancel up its own tree, so Escape in a dialog opened from inside this one
        // would close this one too.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="ks-dialog-inner">
          {icon && (
            <div className="ks-dialog-icon" aria-hidden="true">
              <Icon name={icon} size={24} />
            </div>
          )}
          <div className="ks-dialog-body">
            <h2 id={titleId} className="t-h3">
              {title}
            </h2>
            {children}
          </div>
          <div className="ks-dialog-actions">{actions}</div>
        </div>
      )}
    </dialog>
  )
}
