import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { holdPage } from '../../lib/holdPage'
import { useIsDesktop } from '../../lib/useIsDesktop'
import { IconButton } from '../IconButton'
import { useToastLayer } from '../Toast'
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
  /** Next to the title, before the close button, e.g. a Reset button. */
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

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Focuses the first control in the sheet but its close button, as `showModal` would without it: the
 * close button ends the title row, ahead of the fields, where `showModal` would stop. With nothing
 * else to focus, the close button.
 */
function focusFirst(dialog: HTMLDialogElement, close: HTMLButtonElement | null) {
  const first = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].find((element) => element !== close)
  ;(first ?? close)?.focus()
}

/**
 * Bottom sheet on a native modal <dialog>, a centered modal on desktop: focus moves in and stays
 * there, its close button in the title row, Escape and a tap on the backdrop close it, and focus
 * returns to what opened it. On a phone its top (the grabber and the title row) also drags it down to
 * close it.
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
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  // On desktop it's a centered modal with no grabber.
  const isDesktop = useIsDesktop()
  const drag = useSheetDrag(ref, { open, onClose, enabled: !isDesktop })

  // Before showModal and the focus it moves in (`focusFirst`). A layout effect, so a sheet that goes with its
  // screen puts the page back before the next screen's layout effects restore their own place.
  useLayoutEffect(() => (open ? holdPage(ref.current) : undefined), [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // jsdom has no showModal; the open attribute is enough there.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      focusFirst(dialog, closeRef.current)
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])
  // After showModal: toasts show inside the top modal, since the page outside it is inert.
  useToastLayer(ref, open)

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
              <IconButton ref={closeRef} icon="close" label={t('common.close')} onClick={onClose} />
            </div>
          </div>
          <div className="ks-sheet-body">{children}</div>
          {footer && <div className="ks-sheet-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
