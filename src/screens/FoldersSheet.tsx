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
import { useSaves } from '../lib/useSaves'
import { categoryFolder, isAbsolute, knownFolders, sameFolder } from '../torrents/folders'
import { FolderField } from './FolderField'
import { categoryFailure, folderFailure, type FolderFailure } from './folderFailure'
import './FoldersSheet.css'

/** The folder being changed: qBittorrent's default save path, or a category's, as the list had it. */
type Editing = { category?: Category }

/** What the sheet shows: the list, a folder by its `keyOf`, or nothing while it's closed. */
const LIST = 'list'
const CLOSED = 'closed'

function keyOf(category?: Category): string {
  return category ? `category:${category.name}` : 'default'
}

/** The saves of qBittorrent's folders (`useSaves`), by `keyOf`, with the folder sent. */
const FOLDER_SAVES = 'folder'

/** Saves a folder, made first, and says why qBittorrent didn't take it, if it didn't. */
async function saveFolder(category: Category | undefined, folder: string): Promise<FolderFailure | undefined> {
  // The category's own step: its folder is made by then.
  let categoryStep = false
  try {
    // A category's own folder emptied is the default save path and its name, which qBittorrent
    // makes itself; any other is made now, so one it can't make is said here and not saved.
    if (folder) await prepareFolder(folder)
    categoryStep = category !== undefined
    if (category) await setCategoryFolder(category, folder)
    else await setDefaultSavePath(folder)
    return undefined
  } catch (error) {
    return categoryStep ? categoryFailure(error) : folderFailure(error)
  }
}

export interface FoldersSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * qBittorrent's folders, from Settings: the default save path and each category's, loaded when the
 * sheet opens. Picking one changes it in the same sheet. A save outlives its form and the sheet
 * (`useSaves`): the folder stays busy if it's opened again, and its outcome moves the sheet only
 * while that folder is shown, else it's a toast.
 */
export function FoldersSheet({ open, onClose }: FoldersSheetProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const folders = useRequest(open ? 'qbt|folders' : null, (signal) => getFolders(signal))
  const [editing, setEditing] = useState<Editing | null>(null)
  // The last save's failure, said while its folder is shown: any move in the sheet clears it.
  const [failure, setFailure] = useState<FolderFailure>()
  const shown = useRef(CLOSED)
  useEffect(() => {
    shown.current = open ? (editing ? keyOf(editing.category) : LIST) : CLOSED
  }, [open, editing])
  // A save settled while another folder was shown: the list asks again when it's back.
  const stale = useRef(false)

  // A save that settles moves the sheet only while its folder is shown; the list shows what
  // qBittorrent has now, at once when it's shown, else when it's back.
  const saving = useSaves<string>(FOLDER_SAVES, (outcome, _sent, key) => {
    const where = shown.current
    const said = outcome.ok ? (outcome.result as FolderFailure | undefined) : 'common.qbtFailed'
    if (where === key) {
      if (said !== undefined) {
        setFailure(said)
        if (said === 'folders.categoryGone') stale.current = true
      } else {
        stale.current = false
        setEditing(null)
        folders.retry()
      }
      return true
    }
    if (said === undefined || said === 'folders.categoryGone') {
      if (where === LIST) folders.retry()
      else if (where !== CLOSED) stale.current = true
    }
    return false
  })

  const show = (next: Editing | null) => {
    setEditing(next)
    setFailure(undefined)
  }
  const back = () => {
    show(null)
    if (!stale.current) return
    stale.current = false
    folders.retry()
  }
  // Opened again, it loads anew.
  const close = () => {
    show(null)
    stale.current = false
    onClose()
  }

  const save = async (category: Category | undefined, folder: string) => {
    setFailure(undefined)
    const settled = await saving.send(keyOf(category), folder, () => saveFolder(category, folder))
    if (!settled) return
    const said = settled.ok ? settled.result : 'common.qbtFailed'
    if (said === undefined) toast.show(t('folders.saved'), { icon: 'folder' })
    // Not shown, the toast names what failed.
    else if (settled.taken) return
    else if (said === 'move.cantCreate') toast.show(t('folders.cantCreateNamed', { folder }), { icon: 'alert' })
    else if (said === 'folders.categoryGone') toast.show(t('folders.categoryGoneNamed', { name: category?.name }), { icon: 'alert' })
    else toast.show(t(said), { icon: 'alert' })
  }

  const data = folders.data
  const key = editing ? keyOf(editing.category) : LIST
  return (
    <Sheet
      open={open}
      onClose={close}
      title={editing ? (editing.category?.name ?? t('folders.default')) : t('move.known')}
      leading={editing && <IconButton icon="chevron-left" label={t('common.back')} iconSize={24} onClick={back} />}
    >
      {editing && data ? (
        <FolderForm
          folders={data}
          category={editing.category}
          sending={saving.pending(key)}
          failure={failure}
          onSave={(folder) => void save(editing.category, folder)}
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
              <FolderRow label={t('folders.default')} folder={data.defaultPath} onClick={() => show({})} />
              {data.categories.map((category) => (
                <FolderRow
                  key={category.name}
                  label={category.name}
                  folder={categoryFolder(category.name, data)}
                  onClick={() => show({ category })}
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
  /** The folder being saved for it, while it's sent. */
  sending?: string
  failure?: FolderFailure
  onSave: (folder: string) => void
}

/** One folder, typed in full or picked from the ones qBittorrent knows, and saved to qBittorrent. */
function FolderForm({ folders, category, sending, failure, onSave }: FolderFormProps) {
  const { t } = useTranslation()
  const current = category ? categoryFolder(category.name, folders) : folders.defaultPath
  // Where the category's torrents go without a folder of its own.
  const inDefault = category
    ? categoryFolder(category.name, {
        ...folders,
        categories: folders.categories.map((other) => (other.name === category.name ? { ...other, savePath: '' } : other)),
      })
    : ''
  // Opened again while its save is on its way, it starts from what's sent.
  const [value, setValue] = useState(sending ?? current)
  const busy = sending !== undefined
  const target = value.trim()

  const relocates = category ? folders.relocateOnCategoryPathChange : folders.relocateOnDefaultPathChange
  return (
    <form
      className="folders-body"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(target)
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
          size="lg"
          block
          loading={busy}
          disabled={!isAbsolute(target) || sameFolder(target) === sameFolder(current) || busy}
        >
          {t('common.save')}
        </Button>
        {category && (
          <Button type="button" variant="secondary" size="lg" block disabled={!category.savePath || busy} onClick={() => onSave('')}>
            {t('folders.useDefault')}
          </Button>
        )}
      </div>
    </form>
  )
}
