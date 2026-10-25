import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { DownloadsScreen, type DownloadsScreenProps } from './DownloadsScreen'
import { TorrentDrawer } from './TorrentDrawer'

/**
 * Desktop `/` and `/torrent/:hash`: Downloads, with the torrent's details in a drawer over it on the
 * second. Downloads stays mounted while the drawer opens and closes, so its filters, selection and
 * scroll stay too.
 */
export function DownloadsWithDrawer(props: DownloadsScreenProps) {
  const { hash } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // Whether this drawer was opened from the list behind it, rather than from a link elsewhere.
  const [openedHere, setOpenedHere] = useState(false)
  const [path, setPath] = useState(location.pathname)
  if (path !== location.pathname) {
    setOpenedHere(path === '/' && hash !== undefined)
    setPath(location.pathname)
  }

  // Back to the list: one step back when it opened from there, else to Downloads in place of the torrent.
  const close = () => (openedHere ? navigate(-1) : navigate('/', { replace: true }))

  return (
    <>
      <DownloadsScreen {...props} />
      {hash !== undefined && (
        <TorrentDrawer key={hash} hash={hash} onClose={() => void close()} onSessionLost={props.onSessionLost} />
      )}
    </>
  )
}
