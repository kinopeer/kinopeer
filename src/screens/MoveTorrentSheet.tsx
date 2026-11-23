import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSaveLocations, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { isAbsolute, knownFolders, sameFolder } from '../torrents/folders'
import { FolderField } from './FolderField'
import type { FolderFailure } from './folderFailure'
import './MoveTorrentSheet.css'

export interface MoveTorrentSheetProps {
  torrent: Torrent
  /** qBittorrent is unreachable: Move is off. */
  offline: boolean
  /** The folder being sent for this torrent, from this sheet or one closed before it opened, which
   *  this one then starts from. */
  pending?: string
  /** Why qBittorrent didn't take the last folder. */
  failure?: FolderFailure
  onMove: (location: string) => void
  onClose: () => void
}

/** "Move files": a folder for a torrent's files, typed or picked from the ones qBittorrent knows. */
export function MoveTorrentSheet({ torrent, offline, pending, failure, onMove, onClose }: MoveTorrentSheetProps) {
  const { t } = useTranslation()
  const where = useRequest('qbt|save-locations', (signal) => getSaveLocations(signal))
  const folders = where.data ? knownFolders(where.data) : []
  // Opened while a move is in flight, the field shows the folder it sends, as the sheet that sent it did.
  const [location, setLocation] = useState(pending ?? torrent.save_path)
  const sending = pending !== undefined
  const target = location.trim()
  const unchanged = sameFolder(target) === sameFolder(torrent.save_path)

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('move.title')}
      subtitle={torrent.name}
      footer={
        <Button
          variant="primary"
          size="lg"
          icon="folder"
          block
          loading={sending}
          disabled={!isAbsolute(target) || unchanged || sending || offline}
          onClick={() => onMove(target)}
        >
          {t('move.submit')}
        </Button>
      }
    >
      <div className="move-body">
        <FolderField value={location} onChange={setLocation} folders={folders} readOnly={sending} />
        <p className="t-cap c3">{t('move.note')}</p>
        {failure && <Banner tone="error">{t(failure)}</Banner>}
      </div>
    </Sheet>
  )
}
