import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFolders, prepareFolder, setCategoryFolder, setDefaultSavePath, type Category, type Folders } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useRequest } from '../lib/useRequest'
import { categoryFolder, isAbsolute, knownFolders, sameFolder } from '../torrents/folders'
import { FolderField } from './FolderField'
import { folderFailure, type FolderFailure } from './folderFailure'
import './FoldersSheet.css'

/** The folder being changed: qBittorrent's default save path, or a category's, as the list had it. */
type Editing = { category?: Category }

export interface FoldersSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * qBittorrent's folders, from Settings: the default save path and each category's, loaded when the
 * sheet opens. Picking one changes it in the same sheet.
 */
export function FoldersSheet({ open, onClose }: FoldersSheetProps) {
  const { t } = useTranslation()
  const folders = useRequest(open ? 'qbt|folders' : null, (signal) => getFolders(signal))
  const [editing, setEditing] = useState<Editing | null>(null)
  const close = () => {
    setEditing(null)
    onClose()
  }
  const data = folders.data

  return (
    <Sheet
      open={open}
      onClose={close}
      title={editing ? (editing.category?.name ?? t('folders.default')) : t('move.known')}
      leading={editing && <IconButton icon="chevron-left" label={t('common.back')} iconSize={24} onClick={() => setEditing(null)} />}
      action={<IconButton icon="close" label={t('common.close')} onClick={close} />}
    >
      {editing && data ? (
        <FolderForm
          folders={data}
          category={editing.category}
          onSaved={() => {
            setEditing(null)
            folders.retry()
          }}
        />
      ) : (
        <div className="folders-body">
          {folders.error !== undefined && (
            <Banner tone="error" actionLabel={t('common.retry')} onAction={folders.retry}>
              {t('folders.loadFailed')}
            </Banner>
          )}
          {folders.loading && <span className="ks-spin folders-loading" role="status" aria-label={t('folders.loading')} />}
          {data && (
            <ul className="folders-list">
              <FolderRow label={t('folders.default')} folder={data.defaultPath} onClick={() => setEditing({})} />
              {data.categories.map((category) => (
                <FolderRow
                  key={category.name}
                  label={category.name}
                  folder={categoryFolder(category.name, data)}
                  onClick={() => setEditing({ category })}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  )
}

function FolderRow({ label, folder, onClick }: { label: string; folder: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="ks-row-btn folders-row" onClick={onClick}>
        <Icon name="folder" className="c2" />
        <span className="ks-row-text folders-row-text">
          <span>{label}</span>
          <span className="ks-row-hint folders-path">{folder}</span>
        </span>
        <Icon name="chevron-right" className="c3" />
      </button>
    </li>
  )
}

interface FolderFormProps {
  folders: Folders
  /** The category whose folder this is; none for the default save path. */
  category?: Category
  onSaved: () => void
}

/** One folder, typed in full or picked from the ones qBittorrent knows, and saved to qBittorrent. */
function FolderForm({ folders, category, onSaved }: FolderFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const current = category ? categoryFolder(category.name, folders) : folders.defaultPath
  // Where the category's torrents go without a folder of its own.
  const inDefault = category
    ? categoryFolder(category.name, {
        ...folders,
        categories: folders.categories.map((other) => (other.name === category.name ? { ...other, savePath: '' } : other)),
      })
    : ''
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FolderFailure>()
  const target = value.trim()
  // Gone when the sheet closed or went back to the list before the save settled: a failure then
  // goes to a toast.
  const shown = useRef(false)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])

  const save = async (folder: string) => {
    setBusy(true)
    setFailure(undefined)
    try {
      // A category's own folder emptied is the default save path and its name, which qBittorrent
      // makes itself; any other is made now, so one it can't make is said here and not saved.
      if (folder) await prepareFolder(folder)
      if (category) await setCategoryFolder(category, folder)
      else await setDefaultSavePath(folder)
      toast.show(t('folders.saved'), { icon: 'folder' })
      onSaved()
    } catch (error) {
      if (shown.current) setFailure(folderFailure(error))
      else toast.show(t(folderFailure(error)), { icon: 'alert' })
    } finally {
      setBusy(false)
    }
  }

  const relocates = category ? folders.relocateOnCategoryPathChange : folders.relocateOnDefaultPathChange
  return (
    <form
      className="folders-body"
      onSubmit={(event) => {
        event.preventDefault()
        void save(target)
      }}
    >
      <FolderField value={value} onChange={setValue} folders={knownFolders(folders)} readOnly={busy} />
      <p className="t-cap c3">{t('folders.creates')}</p>
      <p className="t-cap c2">{t(relocates ? 'folders.relocates' : 'folders.toManual')}</p>
      {category && <p className="t-cap c3">{t('folders.inDefaultNote', { folder: inDefault })}</p>}
      {failure && <Banner tone="error">{t(failure)}</Banner>}
      <div className="folders-actions">
        <Button
          type="submit"
          block
          loading={busy}
          disabled={!isAbsolute(target) || sameFolder(target) === sameFolder(current) || busy}
        >
          {t('common.save')}
        </Button>
        {category && (
          <Button type="button" variant="secondary" size="lg" block disabled={!category.savePath || busy} onClick={() => void save('')}>
            {t('folders.useDefault')}
          </Button>
        )}
      </div>
    </form>
  )
}
