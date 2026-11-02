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
import { isAbsolute, knownFolders, sameFolder } from '../torrents/folders'
import './MoveTorrentSheet.css'

/** Why qBittorrent didn't take a folder, as a translation key. */
export type MoveFailure = 'move.noAccess' | 'move.cantCreate' | 'torrent.actionFailed'

export interface MoveTorrentSheetProps {
  torrent: Torrent
  /** qBittorrent is unreachable: Move is off. */
  offline: boolean
  /** The folder being sent for this torrent, from this sheet or one closed before it opened, which
   *  this one then starts from. */
  pending?: string
  /** Why qBittorrent didn't take the last folder. */
  failure?: MoveFailure
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
  // qBittorrent checks a relative path against its own working directory but saves under the default
  // save path, and doesn't expand ~, so only a full path is sent.
  const relative = !!target && !isAbsolute(target)

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('move.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('torrent.cancel')} onClick={onClose} />}
      footer={
        <Button
          variant="primary"
          size="lg"
          icon="folder"
          block
          loading={sending}
          disabled={!target || relative || unchanged || sending || offline}
          onClick={() => onMove(target)}
        >
          {t('move.submit')}
        </Button>
      }
    >
      <div className="move-body">
        <Input
          label={t('move.location')}
          value={location}
          mono
          error={relative ? t('move.absolute') : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // What's typed while the move is sent would be lost when it closes the sheet.
          readOnly={sending}
          onChange={(event) => setLocation(event.target.value)}
        />
        {folders.length > 0 && (
          <div role="group" aria-label={t('move.known')} className="move-folders">
            <span className="ks-label">{t('move.known')}</span>
            <div className="move-chips">
              {folders.map((folder) => (
                <FilterChip
                  key={folder}
                  selected={sameFolder(folder) === sameFolder(target)}
                  disabled={sending}
                  onClick={() => setLocation(folder)}
                >
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
