import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSaveLocations, QbittorrentError, setTorrentLocation, UnauthorizedError, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { knownFolders, sameFolder } from '../torrents/folders'
import './MoveTorrentSheet.css'

export interface MoveTorrentSheetProps {
  torrent: Torrent
  onClose: () => void
  /** After qBittorrent took the new folder; it moves the files in the background. */
  onMoved: (location: string) => void
}

type Failure = 'move.noAccess' | 'move.cantCreate' | 'torrent.actionFailed'

/** The banner's text for why qBittorrent didn't take the folder. */
function failureKey(error: unknown): Failure {
  if (error instanceof QbittorrentError && !(error instanceof UnauthorizedError)) {
    if (error.status === 403) return 'move.noAccess'
    if (error.status === 409) return 'move.cantCreate'
  }
  // A lost session included: the Downloads poll notices it and asks for the login.
  return 'torrent.actionFailed'
}

/** "Move to…": sends a torrent's files to another folder through qBittorrent. */
export function MoveTorrentSheet({ torrent, onClose, onMoved }: MoveTorrentSheetProps) {
  const { t } = useTranslation()
  const where = useRequest('qbt|save-locations', () => getSaveLocations())
  const folders = where.data ? knownFolders(where.data.categories, where.data.defaultPath) : []
  const [location, setLocation] = useState(torrent.save_path)
  const [moving, setMoving] = useState(false)
  const [failure, setFailure] = useState<Failure>()
  const target = location.trim()
  const unchanged = sameFolder(target) === sameFolder(torrent.save_path)
  // Kept open until qBittorrent answers, so a failure has somewhere to show.
  const close = () => {
    if (!moving) onClose()
  }

  const move = async () => {
    setMoving(true)
    setFailure(undefined)
    try {
      await setTorrentLocation([torrent.hash], target)
      onMoved(target)
    } catch (error) {
      setFailure(failureKey(error))
      setMoving(false)
    }
  }

  return (
    <Sheet
      open
      onClose={close}
      title={t('move.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('move.cancel')} disabled={moving} onClick={close} />}
      footer={
        <Button
          variant="primary"
          size="lg"
          icon="folder"
          block
          loading={moving}
          disabled={!target || unchanged || moving}
          onClick={() => void move()}
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

