import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCategories, getDefaultSavePath, setTorrentLocation, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import './MoveTorrentSheet.css'

export interface MoveTorrentSheetProps {
  torrent: Torrent
  onClose: () => void
  /** After qBittorrent took the new folder; it moves the files in the background. */
  onMoved: (location: string) => void
}

/** The folders qBittorrent already knows: its default save path and the categories' own paths. */
async function knownFolders(): Promise<string[]> {
  const [categories, defaultPath] = await Promise.all([
    getCategories().catch(() => []),
    getDefaultSavePath().catch(() => ''),
  ])
  const paths = [defaultPath, ...categories.map((category) => category.savePath)]
  return [...new Set(paths.filter(Boolean))]
}

/** "Move to…": sends a torrent's files to another folder through qBittorrent. */
export function MoveTorrentSheet({ torrent, onClose, onMoved }: MoveTorrentSheetProps) {
  const { t } = useTranslation()
  const folders = useRequest('qbt|folders', () => knownFolders())
  const [location, setLocation] = useState(torrent.save_path)
  const [moving, setMoving] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = location.trim()
  const unchanged = trimSlash(target) === trimSlash(torrent.save_path)

  const move = async () => {
    setMoving(true)
    setFailed(false)
    try {
      await setTorrentLocation([torrent.hash], target)
      onMoved(target)
    } catch {
      setFailed(true)
      setMoving(false)
    }
  }

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
        {!!folders.data?.length && (
          <div role="group" aria-label={t('move.known')} className="move-folders">
            <span className="ks-label">{t('move.known')}</span>
            <div className="move-chips">
              {folders.data.map((folder) => (
                <FilterChip key={folder} selected={trimSlash(folder) === trimSlash(target)} onClick={() => setLocation(folder)}>
                  {folder}
                </FilterChip>
              ))}
            </div>
          </div>
        )}
        <p className="t-cap c3">{t('move.note')}</p>
        {failed && <Banner tone="error">{t('move.failed')}</Banner>}
      </div>
    </Sheet>
  )
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/[/\\]+$/, '') : path
}
