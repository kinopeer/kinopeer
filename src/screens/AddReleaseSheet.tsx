import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRelease, type Release, type ReleaseSource } from '../api/prowlarr'
import {
  QbittorrentError,
  getCategories,
  getDefaultSavePath,
  getMainData,
  type Category,
} from '../api/qbittorrent'
import { posterUrl, type MediaType } from '../api/tmdb'
import { Badge } from '../components/Badge'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Poster } from '../components/Poster'
import { Sheet } from '../components/Sheet'
import { Toggle } from '../components/Toggle'
import { useFormatters } from '../lib/format'
import { useRequest } from '../lib/useRequest'
import { addRelease } from '../releases/addRelease'
import type { ReleaseInfo } from '../releases/parseRelease'
import { qualityBadges } from '../releases/qualityBadges'
import { useSettings } from '../settings/settings'
import { tmdbTagFor } from '../torrents/parseName'
import { categoryType } from '../torrents/titleMatches'
import { readTorrentFile, type TorrentMeta } from '../torrents/torrentFile'
import { FilePicker } from './FilePicker'
import { IndexerLink } from './IndexerLink'
import './AddReleaseSheet.css'

export interface AddReleaseSheetProps {
  release: Release
  info: ReleaseInfo
  /** The TMDB title the release is for: tagged on the torrent and shown in the sheet. */
  title: { type: MediaType; id: number; name: string; posterPath?: string | null }
  onClose: () => void
  /** After qBittorrent accepted the torrent. */
  onAdded: () => void
}

interface Prepared {
  source: ReleaseSource
  /** Read from the .torrent; missing for magnet links. */
  meta?: TorrentMeta
}

interface Locations {
  categories: Category[]
  defaultPath: string
  free?: number
}

async function prepare(release: Release, signal: AbortSignal): Promise<Prepared> {
  const source = await fetchRelease(release, signal)
  if (source.kind === 'magnet') return { source }
  // An unreadable file still goes to qBittorrent, just without file selection.
  const meta = await readTorrentFile(await source.file.arrayBuffer()).catch(() => undefined)
  return { source, meta }
}

async function locations(): Promise<Locations> {
  const [categories, defaultPath, free] = await Promise.all([
    getCategories().catch(() => []),
    getDefaultSavePath().catch(() => ''),
    getMainData(0).then(
      (data) => {
        // 0 or less means qBittorrent can't tell, e.g. before its first disk check.
        const free = data.server_state?.free_space_on_disk
        return free !== undefined && free > 0 ? free : undefined
      },
      () => undefined,
    ),
  ])
  return { categories: categories.sort((a, b) => a.name.localeCompare(b.name)), defaultPath, free }
}

/** "Add to downloads": destination, options and file selection for one release. */
export function AddReleaseSheet({ release, info, title, onClose, onAdded }: AddReleaseSheetProps) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const prepared = useRequest(`release|${release.id}`, (signal) => prepare(release, signal))
  const where = useRequest('qbt|locations', () => locations())

  const meta = prepared.data?.meta
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set())
  const [view, setView] = useState<'options' | 'files'>('options')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chosenCategory, setChosenCategory] = useState<string>()
  const [savePath, setSavePath] = useState('')
  const [settings] = useSettings()
  // The defaults from Settings until the user flips them, so defaults the server sends late still apply.
  const [chosenPaused, setPaused] = useState<boolean>()
  const [chosenSequential, setSequential] = useState<boolean>()
  const paused = chosenPaused ?? settings.startPaused
  const sequential = chosenSequential ?? settings.sequential
  const [topOfQueue, setTopOfQueue] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string>()

  const categories = where.data?.categories ?? []
  // Until the user picks one: the default from Settings if qBittorrent still has it, else the first
  // category named like the title's type ("Movies", "TV").
  const preferred = title.type === 'movie' ? settings.movieCategory : settings.tvCategory
  const category =
    chosenCategory ??
    categories.find((candidate) => candidate.name === preferred)?.name ??
    categories.find((candidate) => categoryType(candidate.name) === title.type)?.name ??
    ''
  const categoryPath = categories.find((candidate) => candidate.name === category)?.savePath
  const defaultPath = categoryPath || where.data?.defaultPath || ''
  const destination = savePath.trim() || defaultPath

  const selectedSize = useMemo(
    () => (meta ? meta.files.reduce((sum, file, index) => (skipped.has(index) ? sum : sum + file.size), 0) : release.size),
    [meta, skipped, release.size],
  )
  const fileCount = meta?.files.length ?? 0
  const selectedCount = fileCount - skipped.size
  const free = where.data?.free
  // qBittorrent reports the free space where its default save path is. A warning, not a block: the
  // space may be freed before the download finishes, or the save path may be on another disk. Only by
  // known sizes: a read .torrent's files or a magnet's release size, not an unreadable .torrent's.
  const knownSize = meta !== undefined || prepared.data?.source.kind === 'magnet'
  const lowSpace =
    knownSize && free !== undefined && selectedSize > free
      ? { free: format.size(free), missing: format.size(selectedSize - free) }
      : undefined

  const add = async () => {
    if (!prepared.data) return
    setAdding(true)
    setAddError(undefined)
    try {
      await addRelease(
        prepared.data.source,
        {
          tags: [tmdbTagFor(title.type, title.id)],
          category: category || undefined,
          savePath: savePath.trim() || undefined,
          paused,
          sequential,
          topOfQueue,
        },
        meta && { meta, skip: [...skipped] },
      )
      onAdded()
    } catch (error) {
      setAdding(false)
      setAddError(error instanceof QbittorrentError && error.status === 200 ? t('add.addFailed') : t('add.addError'))
    }
  }

  if (view === 'files' && meta) {
    return (
      <FilePicker
        meta={meta}
        skipped={skipped}
        onChange={setSkipped}
        free={free}
        subtitle={release.title}
        onDone={() => setView('options')}
      />
    )
  }

  const toggles = [
    { label: t('add.startPaused'), checked: paused, set: setPaused },
    { label: t('add.sequential'), checked: sequential, set: setSequential },
    { label: t('add.addTop'), checked: topOfQueue, set: setTopOfQueue },
  ]

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('add.title')}
      action={<IconButton icon="close" label={t('add.cancel')} onClick={onClose} />}
      footer={
        <div className="add-foot">
          <Button
            variant="primary"
            size="lg"
            icon="download"
            block
            loading={adding}
            disabled={!prepared.data || adding || (fileCount > 0 && selectedCount === 0)}
            onClick={() => void add()}
          >
            {t('add.download', { size: format.size(selectedSize) })}
          </Button>
        </div>
      }
    >
      <div className="add-body">
        <div className="add-release">
          <Poster src={posterUrl(title.posterPath ?? null, 'w185')} className="add-poster" />
          <div className="add-release-text">
            <div className="t-label add-title">{title.name}</div>
            <div className="t-cap ks-clamp2 c2 add-name">{release.title}</div>
            <div className="add-badges">
              {qualityBadges(info).map((badge) => (
                <Badge key={badge.label} kind={badge.kind}>
                  {badge.label}
                </Badge>
              ))}
            </div>
            <div className="t-cap ks-num c2 add-meta">
              <span className="add-size">{format.size(release.size)}</span>
              <span aria-label={t('releases.seeders', { count: release.seeders ?? 0 })}>
                <Icon name="arrow-up" size={13} />
                {(release.seeders ?? 0).toLocaleString(i18n.language)}
              </span>
              <IndexerLink release={release} />
            </div>
          </div>
        </div>

        {prepared.loading && (
          <div className="add-row" role="status">
            <span className="ks-spin ca" />
            <span className="c2">{t('add.fetching')}</span>
          </div>
        )}
        {prepared.error !== undefined && (
          <Banner tone="error" actionLabel={t('common.retry')} onAction={prepared.retry}>
            {t('add.fetchFailed')}
          </Banner>
        )}
        {meta && fileCount > 1 && (
          <button type="button" className="ks-row-btn add-files" onClick={() => setView('files')}>
            <Icon name="folder" className="c2" />
            <span className="add-files-text">
              <span className="add-files-label">
                {selectedCount === fileCount
                  ? t('add.filesAll', { count: fileCount })
                  : t('add.filesSome', { selected: selectedCount, count: fileCount })}
              </span>
              <span className="t-cap c3 ks-num">
                {format.size(selectedSize)}
                {free !== undefined && ` · ${t('add.freeSpace', { size: format.size(free) })}`}
              </span>
            </span>
            <span className="t-label ca add-change">{t('add.change')}</span>
            <Icon name="chevron-right" size={18} className="c3" />
          </button>
        )}
        {prepared.data?.source.kind === 'magnet' && <p className="t-cap c3">{t('add.magnetFiles')}</p>}
        {lowSpace && (
          <Banner icon="disk" title={t('add.notEnough')}>
            {t('add.lowSpace', lowSpace)}{' '}
            {fileCount > 1 ? t('add.lowSpaceSkip') : t('add.lowSpaceFree')}
          </Banner>
        )}

        {destination && (
          <div className="t-cap c2 add-dest">
            <Icon name="folder" size={16} />
            <span className="ks-trunc">
              {category ? `${category} → ${destination}` : destination}
            </span>
          </div>
        )}

        <div className="add-options">
          <button type="button" className="ks-acc-head" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>
            {t('add.options')}
            <Icon name="chevron-down" />
          </button>
          {optionsOpen && (
            <div className="add-options-body">
              {categories.length > 0 && (
                <div role="group" aria-label={t('add.category')} className="add-field">
                  <span className="ks-label">{t('add.category')}</span>
                  <div className="add-categories">
                    {[{ name: '' }, ...categories].map((option) => (
                      <FilterChip
                        key={option.name}
                        selected={option.name === category}
                        onClick={() => setChosenCategory(option.name)}
                      >
                        {option.name || t('add.noCategory')}
                      </FilterChip>
                    ))}
                  </div>
                </div>
              )}
              <Input
                label={t('add.savePath')}
                value={savePath}
                placeholder={defaultPath}
                mono
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => setSavePath(event.target.value)}
              />
              {toggles.map((toggle) => (
                <div key={toggle.label} className="add-toggle">
                  <span className="t-body">{toggle.label}</span>
                  <Toggle label={toggle.label} checked={toggle.checked} onChange={toggle.set} />
                </div>
              ))}
            </div>
          )}
        </div>

        {addError && (
          <Banner tone="error">{addError}</Banner>
        )}
      </div>
    </Sheet>
  )
}
