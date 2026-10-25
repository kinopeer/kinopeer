import { useEffect, useId, useRef } from 'react'
import { useLocation, useNavigate, useParams, type Location } from 'react-router'
import { TorrentDetails, type TorrentDetailsProps } from './TorrentDetails'

export interface TorrentDrawerProps extends Pick<TorrentDetailsProps, 'onDeleted' | 'behind'> {
  hash: string
  onClose: () => void
  onSessionLost?: () => void
}

/**
 * A torrent's details in a drawer on the right, over the page it was opened from (desktop). A native modal <dialog>:
 * the rest of the page is inert, Escape and a click on the backdrop close it, focus starts on the
 * Close button and goes back to what had it before (the row's title) when the drawer goes away.
 */
export function TorrentDrawer({ hash, onClose, onSessionLost, onDeleted, behind }: TorrentDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // jsdom has no showModal; the open attribute is enough there.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLElement>('.torrent-close')?.focus()
    return () => {
      // Closed first, so the page behind isn't inert any more and the opener can take focus.
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="ks-drawer"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // The content fills the dialog, so a click on the dialog itself is a click on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <TorrentDetails
        hash={hash}
        onSessionLost={onSessionLost}
        onClose={onClose}
        onDeleted={onDeleted}
        behind={behind}
        titleId={titleId}
      />
    </dialog>
  )
}

export interface TorrentDrawerOverPageProps {
  /** The page the drawer was opened from, which stays under it. */
  background: Location
  onSessionLost?: () => void
}

/**
 * Desktop `/torrent/:hash` opened by a link on another page, such as the title page's "In
 * downloads": the drawer over that page. Closing it, or deleting the torrent, goes back to the page.
 */
export function TorrentDrawerOverPage({ background, onSessionLost }: TorrentDrawerOverPageProps) {
  const { hash } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // One step back to the page; a restored first entry has nothing behind it, so the page replaces it.
  const close = () =>
    void (location.key !== 'default'
      ? navigate(-1)
      : navigate(background, { replace: true, state: background.state }))
  if (hash === undefined) return null
  return (
    <TorrentDrawer
      key={hash}
      hash={hash}
      onClose={close}
      onDeleted={close}
      behind={background.pathname}
      onSessionLost={onSessionLost}
    />
  )
}
