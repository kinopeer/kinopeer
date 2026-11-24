import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { ProwlarrKeyReadError, fetchRelease, type Release, type ReleaseSource } from '../api/prowlarr'
import { NOTIFY_TAG, TorrentRefusedError, getSaveLocations, getTorrents, unreachable, type Torrent } from '../api/qbittorrent'
import { posterUrl, type MediaType } from '../api/tmdb'
import { Accordion } from '../components/Accordion'
import { Badge } from '../components/Badge'
import { Banner } from '../components/Banner'
import { Button, ButtonLink } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { Input } from '../components/Input'
import { Poster } from '../components/Poster'
import { Sheet } from '../components/Sheet'
import { Toggle } from '../components/Toggle'
import { overPage } from '../lib/background'
import { useFormatters } from '../lib/format'
import { useRequest } from '../lib/useRequest'
import { MediaNamesError, addRelease } from '../releases/addRelease'
import type { ReleaseInfo } from '../releases/parseRelease'
import { qualityBadges, sourceName } from '../releases/qualityBadges'
import { useSettings } from '../settings/settings'
import { addFolder } from '../torrents/folders'
import { titleNames } from '../torrents/seriesNames'
import { parseMagnet } from '../torrents/magnet'
import { tmdbTagFor } from '../torrents/parseName'
import { torrentId } from '../torrents/sameTorrent'
import { categoryType } from '../torrents/titleLookup'
import { readTorrentFile, type TorrentMeta } from '../torrents/torrentFile'
import { estimatedFreeSpace, withFreed, type FreedSpace } from '../torrents/freeUpSpace'
import { useFreeSpace } from '../torrents/useMainData'
import { qbtFailedText, unreachableText } from '../lib/unreachable'
import { FilePicker } from './FilePicker'
import { FreeUpSpace } from './FreeUpSpace'
import { IndexerLink } from './IndexerLink'
import { notNamedText } from './notNamedText'
import { useNotificationsAvailable } from './useNotificationsAvailable'
import './AddReleaseSheet.css'

export interface AddReleaseSheetProps {
  release: Release
  info: ReleaseInfo
  /** The TMDB title the release is for: tagged on the torrent and shown in the sheet. */
  title: { type: MediaType; id: number; name: string; year?: number; posterPath?: string | null }
  onClose: () => void
  /** After qBittorrent accepted the torrent. */
  onAdded: () => void
}

interface Prepared {
  source: ReleaseSource
  /** Read from the .torrent; missing for magnet links and links qBittorrent follows itself. */
  meta?: TorrentMeta
}

/** A v1 info hash, 40 hex digits: the ID qBittorrent knows a torrent by, a hybrid's included. */
const V1_HASH = /^\s*[0-9a-f]{40}\s*$/i

async function prepare(release: Release, signal: AbortSignal): Promise<Prepared> {
  const source = await fetchRelease(release, signal)
  if (source.kind !== 'torrent') return { source }
  // An unreadable file still goes to qBittorrent, just without file selection.
  const meta = await readTorrentFile(await source.file.arrayBuffer()).catch(() => undefined)
  return { source, meta }
}

/**
 * The info hash of what Prowlarr gave: the .torrent's, else the magnet link's, else, for a link
 * qBittorrent follows itself, the one Prowlarr gave with the release; undefined when none says.
 * `certain` is whether qBittorrent, asked by its ID, would find the torrent if it has it: not for a v2
 * hash alone, which a hybrid torrent's ID (its v1 hash) isn't.
 */
function infoHashOf(release: Release, prepared: Prepared | undefined): { infoHash?: string; certain: boolean } {
  if (prepared?.meta) return { infoHash: prepared.meta.infoHash, certain: true }
  if (__WEBUI__ && prepared?.source.kind === 'link') return { infoHash: release.infoHash, certain: V1_HASH.test(release.infoHash ?? '') }
  const magnet = prepared?.source.kind === 'magnet' ? parseMagnet(prepared.source.uri) : undefined
  return { infoHash: magnet?.infoHash, certain: !magnet?.v2Only }
}

/** The torrent qBittorrent has with this ID, or null: one request for that torrent alone. */
async function inDownloads(id: string, signal?: AbortSignal): Promise<Torrent | null> {
  return (await getTorrents({ hashes: [id] }, signal)).find((torrent) => torrent.hash === id) ?? null
}

/**
 * "Add to downloads": destination, options and file selection for one release, or, when qBittorrent
 * already has its torrent, a way to open that torrent instead.
 */
export function AddReleaseSheet({ release, info, title, onClose, onAdded }: AddReleaseSheetProps) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const location = useLocation()
  const hintId = useId()
  const prepared = useRequest(`release|${release.id}`, (signal) => prepare(release, signal))
  const hash = infoHashOf(release, prepared.data)
  const id = torrentId(hash.infoHash)
  // Whether qBittorrent has it already; if this fails, Download stays: sending it says what's wrong.
  const existing = useRequest(id === undefined ? null : `qbt|torrent|${id}`, (signal) => inDownloads(id ?? '', signal))
  // Found after qBittorrent refused to add it, which it does for a torrent it has.
  const [refusedAsAdded, setRefusedAsAdded] = useState<Torrent>()
  const added = refusedAsAdded ?? existing.data ?? undefined
  // Added, but its files weren't named: the sheet opens the torrent, whose More menu names them, and
  // offers no second Download, which qBittorrent would refuse, even when it can't say it has it.
  const [addedUnnamed, setAddedUnnamed] = useState(false)
  // The form, held back until it's known whether qBittorrent has the torrent, so it doesn't go away
  // under a finger when it does, and out of a sheet without a torrent to send.
  const offered = !added && !addedUnnamed && prepared.data !== undefined && !existing.loading
  const where = useRequest('qbt|locations', (signal) => getSaveLocations(signal))
  const reported = useFreeSpace()
  // What deletes from Free up space freed, until qBittorrent measures the disk again.
  const [freed, setFreed] = useState<FreedSpace>()
  // A new figure has measured what was freed: the hold goes, so it can't come back with an old figure.
  if (freed && freed.reported !== reported) setFreed(undefined)
  const { free, estimate } = estimatedFreeSpace(freed, reported)

  const meta = prepared.data?.meta
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set())
  const [view, setView] = useState<'options' | 'files' | 'free'>('options')
  // Where Free up space goes back to: the sheet or the file picker it was opened from.
  const [freeFrom, setFreeFrom] = useState<'options' | 'files'>()
  // The file picker's open folders, so it opens again as it was left, after Free up space too.
  const [pickerFolders, setPickerFolders] = useState<ReadonlySet<string>>()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chosenCategory, setChosenCategory] = useState<string>()
  const [savePath, setSavePath] = useState('')
  const [settings] = useSettings()
  // The defaults from Settings until the user flips them, so defaults the server sends late still apply.
  const [chosenPaused, setPaused] = useState<boolean>()
  const [chosenSequential, setSequential] = useState<boolean>()
  const [chosenFirstLast, setFirstLast] = useState<boolean>()
  const [chosenNotify, setNotify] = useState<boolean>()
  const [chosenNames, setNames] = useState<boolean>()
  const paused = chosenPaused ?? settings.startPaused
  const sequential = chosenSequential ?? settings.sequential
  const firstLastPieces = chosenFirstLast ?? settings.firstLastPieces
  // Offered, and its default applied, only while a channel is set up, as on a torrent's page.
  const notifications = useNotificationsAvailable()
  const notify = notifications && (chosenNotify ?? settings.notify)
  const [topOfQueue, setTopOfQueue] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string>()
  // The files named for a media server, from the .torrent's files as qBittorrent lays them out by
  // default; a magnet link's aren't known until the torrent starts.
  const namesPlan = useMemo(
    () =>
      meta
        ? titleNames(
            { type: title.type, title: title.name, year: title.year, tmdbId: settings.tmdbIds ? title.id : undefined },
            meta.files.map((file) => ({ name: meta.multiFile ? `${meta.name}/${file.path}` : file.path, size: file.size })),
            release.title,
          )
        : undefined,
    [title.type, title.name, title.year, title.id, settings.tmdbIds, meta, release.title],
  )
  const namable = namesPlan?.named === true
  const mediaNames = namable && (chosenNames ?? settings.mediaNames)

  const categories = where.data?.categories ?? []
  // Until the user picks one: the default from Settings if qBittorrent still has it, else the first
  // category named like the title's type ("Movies", "TV").
  const preferred = title.type === 'movie' ? settings.movieCategory : settings.tvCategory
  const category =
    chosenCategory ??
    categories.find((candidate) => candidate.name === preferred)?.name ??
    categories.find((candidate) => categoryType(candidate.name) === title.type)?.name ??
    ''
  const defaultPath = where.data ? addFolder(category, where.data) : ''
  const destination = savePath.trim() || defaultPath

  const selectedSize = useMemo(
    () => (meta ? meta.files.reduce((sum, file, index) => (skipped.has(index) ? sum : sum + file.size), 0) : release.size),
    [meta, skipped, release.size],
  )
  const fileCount = meta?.files.length ?? 0
  const selectedCount = fileCount - skipped.size
  // qBittorrent reports the free space where its default save path is. A warning, not a block: the
  // space may be freed before the download finishes, or the save path may be on another disk. Only by
  // known sizes: a read .torrent's files or a link's release size, not an unreadable .torrent's.
  // An estimate after a delete is marked as one until qBittorrent measures again.
  const shownSize = (bytes: number) => (estimate ? t('common.approximately', { value: format.size(bytes) }) : format.size(bytes))
  const knownSize =
    meta !== undefined ||
    (__WEBUI__ ? prepared.data !== undefined && prepared.data.source.kind !== 'torrent' : prepared.data?.source.kind === 'magnet')
  const lowSpace =
    knownSize && free !== undefined && selectedSize > free
      ? { free: shownSize(free), missing: format.size(selectedSize - free) }
      : undefined

  const add = async () => {
    if (!prepared.data) return
    setAdding(true)
    setAddError(undefined)
    try {
      await addRelease(
        prepared.data.source,
        {
          tags: [tmdbTagFor(title.type, title.id), ...(notify ? [NOTIFY_TAG] : [])],
          category: category || undefined,
          savePath: savePath.trim() || undefined,
          paused,
          sequential,
          firstLastPieces,
          topOfQueue,
          mediaNames: mediaNames
            ? { type: title.type, title: title.name, year: title.year, tmdbId: settings.tmdbIds ? title.id : undefined, hint: release.title }
            : undefined,
        },
        meta && { meta, skip: [...skipped] },
      )
      onAdded()
    } catch (error) {
      if (error instanceof MediaNamesError) {
        // qBittorrent has it, started as asked: the sheet says what didn't happen and opens it.
        const there = id === undefined ? undefined : await inDownloads(id).catch(() => undefined)
        setAdding(false)
        setAddedUnnamed(true)
        if (there) setRefusedAsAdded(there)
        const { taken } = error
        setAddError(taken ? t(taken.shared ? 'names.addTakenFiles' : 'names.addTaken', { name: taken.name, folder: taken.folder }) : t('names.addFailed'))
        return
      }
      if (!(error instanceof TorrentRefusedError)) {
        setAdding(false)
        setAddError(qbtFailedText(t, error))
        return
      }
      // qBittorrent refuses a torrent it already has, among other reasons: ask it which.
      const there = id === undefined ? undefined : await inDownloads(id).catch(() => undefined)
      setAdding(false)
      if (there) setRefusedAsAdded(there)
      else setAddError(there === null && hash.certain ? t('add.notAdded') : t('add.addFailed'))
    }
  }

  const freeUp = (from: 'options' | 'files') => {
    setFreeFrom(from)
    setView('free')
  }
  // Once opened, rendered with every view, so a delete sent from it that settles after Back still counts.
  const freeUpStep = freeFrom && (
    <FreeUpSpace
      open={view === 'free'}
      size={selectedSize}
      free={free}
      estimate={estimate}
      defaultSavePath={where.data?.defaultPath}
      subtitle={release.title}
      onFreed={(bytes) => setFreed((held) => withFreed(held, reported, bytes))}
      onBack={() => setView(freeFrom)}
    />
  )

  // The step after the view, in the same place whichever shows, so it isn't mounted again.
  if (view === 'free') return <>{null}{freeUpStep}</>
  if (view === 'files' && meta) {
    return (
      <>
        <FilePicker
          meta={meta}
          skipped={skipped}
          onChange={setSkipped}
          free={free}
          estimate={estimate}
          subtitle={release.title}
          openFolders={pickerFolders}
          onOpenFolders={setPickerFolders}
          onFreeUp={() => freeUp('files')}
          onDone={() => setView('options')}
        />
        {freeUpStep}
      </>
    )
  }

  const namesHint = !namesPlan
    ? t('names.addNoFiles')
    : !namesPlan.named
      ? notNamedText(namesPlan.reason, t)
      : mediaNames
        ? t(title.type === 'movie' ? 'names.addAs' : 'names.addAsSeries', { name: namesPlan.folder.to })
        : undefined
  const toggles: { label: string; checked: boolean; set: (on: boolean) => void; hint?: string; disabled?: boolean }[] = [
    { label: t('add.startPaused'), checked: paused, set: setPaused },
    { label: t('add.sequential'), checked: sequential, set: setSequential },
    { label: t('add.firstLastPieces'), checked: firstLastPieces, set: setFirstLast },
    ...(notifications ? [{ label: t('add.notify'), checked: notify, set: setNotify }] : []),
    { label: t('add.mediaNames'), checked: mediaNames, set: setNames, hint: namesHint, disabled: !namable },
    { label: t('add.addTop'), checked: topOfQueue, set: setTopOfQueue },
  ]

  return (
    <>
    <Sheet
      open
      onClose={onClose}
      title={t('add.title')}
      footer={
        <div className="add-foot">
          {added ? (
            <ButtonLink to={`/torrent/${added.hash}`} state={overPage(location)} size="lg" icon="info" block onClick={onClose}>
              {t('downloads.openDetails')}
            </ButtonLink>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon="download"
              block
              loading={adding}
              disabled={!offered || adding || (fileCount > 0 && selectedCount === 0)}
              onClick={() => void add()}
            >
              {t('add.download', { size: format.size(selectedSize) })}
            </Button>
          )}
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
              {qualityBadges(info, sourceName(t)).map((badge) => (
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

        {(prepared.loading || existing.loading) && (
          <div className="add-row" role="status">
            <span className="ks-spin ca" />
            <span className="c2">{prepared.loading ? t('add.fetching') : t('add.checking')}</span>
          </div>
        )}
        {prepared.error !== undefined && (
          <Banner tone="error" actionLabel={t('common.retry')} onAction={prepared.retry}>
            {/* In the WebUI build qBittorrent may not have given Prowlarr's address and key. */}
            {__WEBUI__ && prepared.error instanceof ProwlarrKeyReadError
              ? t('common.qbtFailed')
              : unreachableText(unreachable(prepared.error))
                ? t('common.qbtFailed_kinopeer')
                : t('add.fetchFailed')}
          </Banner>
        )}
        {added && !addedUnnamed && <Banner tone="info" icon="check-circle" title={t('add.alreadyAdded')} />}
        {offered && meta && fileCount > 1 && (
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
                {free !== undefined && ` · ${t('common.freeSpace', { size: shownSize(free) })}`}
              </span>
            </span>
            <span className="t-label ca add-change">{t('common.change')}</span>
            <Icon name="chevron-right" size={18} className="c3" />
          </button>
        )}
        {offered &&
          (__WEBUI__
            ? // Only the WebUI build has a link qBittorrent follows itself, which gets its files as a magnet link does.
              prepared.data !== undefined &&
              prepared.data.source.kind !== 'torrent' && (
                <p className="t-cap c3">{t(prepared.data.source.kind === 'link' ? 'webui.linkFiles' : 'add.magnetFiles')}</p>
              )
            : prepared.data?.source.kind === 'magnet' && <p className="t-cap c3">{t('add.magnetFiles')}</p>)}
        {offered && lowSpace && (
          <Banner icon="disk" title={t('add.notEnough')} actionLabel={t('freeUp.title')} onAction={() => freeUp('options')} wrapActions>
            {t('add.lowSpace', lowSpace)}{' '}
            {fileCount > 1 ? t('add.lowSpaceSkip') : t('add.lowSpaceFree')}
          </Banner>
        )}

        {offered && destination && (
          <div className="t-cap c2 add-dest">
            <Icon name="folder" size={16} />
            <span className="ks-trunc">
              {category ? `${category} → ${destination}` : destination}
            </span>
          </div>
        )}

        {offered && (
          <Accordion
            className="add-options"
            bodyClassName="add-options-body"
            title={t('add.options')}
            open={optionsOpen}
            onOpenChange={setOptionsOpen}
          >
            {categories.length > 0 && (
              <div role="group" aria-label={t('category.title')} className="add-field">
                <span className="ks-label">{t('category.title')}</span>
                <div className="add-categories">
                  {[{ name: '' }, ...categories].map((option) => (
                    <FilterChip
                      key={option.name}
                      selected={option.name === category}
                      onClick={() => setChosenCategory(option.name)}
                    >
                      {option.name || t('category.none')}
                    </FilterChip>
                  ))}
                </div>
              </div>
            )}
            <Input
              label={t('common.folder')}
              value={savePath}
              placeholder={defaultPath}
              mono
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setSavePath(event.target.value)}
            />
            {toggles.map((toggle, index) => (
              <div key={toggle.label} className="add-toggle">
                <span className="add-toggle-text">
                  <span className="t-body">{toggle.label}</span>
                  {toggle.hint && (
                    <span id={`${hintId}-${index}`} className="t-cap c3">
                      {toggle.hint}
                    </span>
                  )}
                </span>
                <Toggle
                  label={toggle.label}
                  checked={toggle.checked}
                  disabled={toggle.disabled}
                  aria-describedby={toggle.hint ? `${hintId}-${index}` : undefined}
                  onChange={toggle.set}
                />
              </div>
            ))}
          </Accordion>
        )}

        {addError && (
          <Banner tone="error">{addError}</Banner>
        )}
      </div>
    </Sheet>
    {freeUpStep}
    </>
  )
}
