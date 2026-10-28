import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSaveLocations, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { knownFolders, sameFolder } from '../torrents/folders'
import './MoveTorrentSheet.css'

/** Why qBittorrent didn't take a folder, as a translation key. */
export type MoveFailure = 'move.noAccess' | 'move.cantCreate' | 'torrent.actionFailed'

export interface MoveTorrentSheetProps {
  torrent: Torrent
  /** qBittorrent is unreachable: Move is off. */
  offline: boolean
  /** The move is being sent. */
  sending: boolean
  /** Why qBittorrent didn't take the last folder. */
  failure?: MoveFailure
  onMove: (location: string) => void
  onClose: () => void
}

/** "Move files": a folder for a torrent's files, typed or picked from the ones qBittorrent knows. */
export function MoveTorrentSheet({ torrent, offline, sending, failure, onMove, onClose }: MoveTorrentSheetProps) {
  const { t } = useTranslation()
  const where = useRequest('qbt|save-locations', () => getSaveLocations())
  const folders = where.data ? knownFolders(where.data) : []
  const [location, setLocation] = useState(torrent.save_path)
  const target = location.trim()
  const unchanged = sameFolder(target) === sameFolder(torrent.save_path)

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('move.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('move.cancel')} onClick={onClose} />}
      footer={
        <Button
          variant="primary"
          size="lg"
          icon="folder"
          block
          loading={sending}
          disabled={!target || unchanged || sending || offline}
          onClick={() => onMove(target)}
        >
          {t('move.submit')}
        </Button>
      }
      className="move-sheet"
    >
      <div className="move-body">
        <Input
          label={t('move.location')}
          value={location}
          mono
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setLocation(event.target.value)}
        />
        {folders.length > 0 && (
          <div role="group" aria-label={t('move.known')} className="move-folders">
            <span className="ks-label">{t('move.known')}</span>
            <div className="move-chips">
              {folders.map((folder) => (
                <FilterChip key={folder} selected={sameFolder(folder) === sameFolder(target)} onClick={() => setLocation(folder)}>
                  {folder}
                </FilterChip>
              ))}
            </div>
          </div>
        )}
        <p className="t-cap c3">{t('move.note')}</p>
        {failure && <Banner tone="error">{t(failure)}</Banner>}
      </div>
    </Sheet>
  )
}
