import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { PosterCardSkeleton } from '../components/PosterCard'
import { Segmented } from '../components/Segmented'
import { useToast } from '../components/Toast'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { useHeightVar } from '../lib/useHeightVar'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useSettings } from '../settings/settings'
import { freeSpace } from '../torrents/freeSpace'
import { clickedOrder, compareTorrents, usualOrder, type DownloadOrder, type DownloadSort } from '../torrents/sort'
import { STATUS_FILTERS, matchesFilter, type StatusFilter } from '../torrents/status'
import { useServerMatches } from '../torrents/serverMatches'
import { TYPE_FILTERS, isGuessed, titleType, useTitleMatches, type TypeFilter } from '../torrents/titleMatches'
import { useMainData, type MainDataState } from '../torrents/useMainData'
import { BulkActionsBar } from './BulkActionsBar'
import { DownloadCard } from './DownloadCard'
import { DownloadItem } from './DownloadItem'
import { DownloadRow, DownloadRowHeader } from './DownloadRow'
import { InstallCard } from './InstallCard'
import { OfflineBanner } from './OfflineBanner'
import { PollRing } from './PollRing'
import { SortMenu, SortSheet } from './SortSheet'
import { StatusMenu } from './StatusMenu'
import { TorrentActionsSheet } from './TorrentActionsSheet'
import { useAltSpeedSwitch } from './useAltSpeedSwitch'
import { useDeleteTorrents } from './useDeleteTorrents'
import { useMoveTorrent } from './useMoveTorrent'
import { usePauseResume } from './usePauseResume'
import { useRecheck } from './useRecheck'
import { useSpeedLimits } from './useSpeedLimits'
import { useChangeTitle } from './useTitleChoice'
import { useTorrentOverlay } from './useTorrentOverlay'
import './DownloadsScreen.css'

export interface DownloadsScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
  /** Selection mode puts its actions bar in place of the tab bar, so the app hides the tab bar meanwhile. */
  onSelectingChange?: (selecting: boolean) => void
}

const SKELETON_ROWS = 5
const SKELETON_CARDS = 4

export function DownloadsScreen({ onSessionLost, onSelectingChange }: DownloadsScreenProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const main = useMainData(onSessionLost)
  const { data, offline, updatedAt, refresh } = main
  const location = useLocation()
  const navigate = useNavigate()
  // Set by the releases screen after adding a release.
  const { added } = (location.state ?? {}) as { added?: string }
  const toast = useToast()
  // Said once: the state goes, so Back or a reload doesn't say it again.
  useEffect(() => {
    if (!added) return
    toast.show(t('add.added', { title: added }))
    void navigate(location.pathname, { replace: true, state: null })
  }, [added, toast, t, navigate, location.pathname])
  const isDesktop = useIsDesktop()
  // The desktop header stays at the top while the list scrolls, and the table's column names stick
  // right under it: its height (the filters wrap, the offline banner comes and goes) is theirs in CSS.
  const headRef = useHeightVar('--downloads-head')
  const [{ downloadsView, downloadsDesktopView, downloadsSort: sort, downloadsSortDescending }, updateSettings] = useSettings()
  // Each layout remembers its own view: the desktop's list is a table, and its grid is the default.
  const view = isDesktop ? downloadsDesktopView : downloadsView
  const setView = (next: 'list' | 'grid') =>
    updateSettings(isDesktop ? { downloadsDesktopView: next } : { downloadsView: next })
  const grid = view === 'grid'
  // The direction is desktop's alone, where the column headers and the sort button show it; the
  // phone's sort sheet has none, so the list there is in the sort's usual direction.
  const descending = isDesktop ? downloadsSortDescending : usualOrder(sort).descending
  const order = useMemo(() => ({ sort, descending }), [sort, descending])
  const setOrder = (next: DownloadOrder) =>
    updateSettings({ downloadsSort: next.sort, downloadsSortDescending: next.descending })
  // A pick from the menu or the sheet is that sort in its usual direction.
  const pickSort = (next: DownloadSort) => setOrder(usualOrder(next))
  const [sortOpen, setSortOpen] = useState(false)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const actions = useTorrentOverlay(data?.torrents)
  // The More button that opened the actions: on desktop they are a menu next to it.
  const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null)
  const pauseResume = usePauseResume()
  const move = useMoveTorrent({ torrents: data?.torrents, offline, refresh })
  // The selected hashes in selection mode, null outside it.
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  const selecting = selected !== null
  useEffect(() => {
    if (!selecting) return
    onSelectingChange?.(true)
    return () => onSelectingChange?.(false)
  }, [selecting, onSelectingChange])
  // Tell the user when qBittorrent answers again after an outage.
  const wasOffline = useRef(offline)
  useEffect(() => {
    if (offline === wasOffline.current) return
    wasOffline.current = offline
    if (!offline) toast.show(t('offline.reconnected'))
  }, [offline, toast, t])

  const torrents = useMemo(() => (data ? Object.values(data.torrents) : []), [data])
  const matches = useTitleMatches(torrents)
  const retitle = useChangeTitle({ torrents: data?.torrents, matchOf: (torrent) => matches[torrent.hash] })
  const nameOf = (torrent: Torrent) => matches[torrent.hash]?.title ?? torrent.name
  const limits = useSpeedLimits({ torrents: data?.torrents, offline, refresh, titleOf: nameOf })
  const recheck = useRecheck({ torrents: data?.torrents, titleOf: nameOf })
  // A row's or the selection's; the selection ends once its torrents are deleted.
  const remove = useDeleteTorrents({
    torrents: data?.torrents,
    titleOf: nameOf,
    onDeleted: () => setSelected(null),
  })
  const serverMatches = useServerMatches()
  // The status filter counts within the picked type, so its numbers match the list.
  const typed = useMemo(
    () =>
      type === 'all'
        ? torrents
        : torrents.filter(
            (torrent) => titleType(torrent, serverMatches?.[torrent.hash], matches[torrent.hash]) === type,
          ),
    [torrents, type, serverMatches, matches],
  )
  const counts = useMemo(
    () =>
      Object.fromEntries(
        STATUS_FILTERS.map((key) => [key, typed.filter((torrent) => matchesFilter(torrent, key)).length]),
      ) as Record<StatusFilter, number>,
    [typed],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return typed
      .filter(
        (torrent) =>
          matchesFilter(torrent, filter) &&
          (!needle ||
            torrent.name.toLocaleLowerCase().includes(needle) ||
            !!matches[torrent.hash]?.title.toLocaleLowerCase().includes(needle)),
      )
      .sort(compareTorrents(order, (torrent) => matches[torrent.hash]?.title ?? torrent.name))
  }, [typed, filter, query, matches, order])
  // The table's "#" column only when the queue order puts a position on some torrent shown, or while
  // that order is reversed, so its header is there to turn it back once the queue has emptied.
  const queueColumn = sort === 'priority' && (descending || visible.some((torrent) => torrent.priority > 0))

  // Only what's on screen counts, so a filter never leaves hidden torrents selected.
  const selectedVisible = selected ? visible.filter((torrent) => selected.has(torrent.hash)) : []
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length
  // The rows are memoized, so what they're handed stays the same from poll to poll (`toggleSelected`,
  // `openActions`, `toggleRunning`) and only a row whose torrent, title or flags changed renders.
  const toggleSelected = useCallback(
    (torrent: Torrent) =>
      setSelected((current) => {
        const next = new Set(current)
        if (!next.delete(torrent.hash)) next.add(torrent.hash)
        return next
      }),
    [],
  )

  const loading = data === null
  // Looked up on every render, so the sheet follows live status changes and closes if the torrent goes away.
  const actionsTorrent = actions.torrent
  const server = data?.server
  const free = freeSpace(server?.free_space_on_disk)

  const toggleSearch = () => {
    setSearchOpen((open) => !open)
    setQuery('')
  }

  // On desktop the actions are a menu, and its More button toggles it. Read when clicked, so the
  // function the rows get never changes.
  const showActions = (torrent: Torrent, anchor: HTMLElement) => {
    if (actionsTorrent?.hash === torrent.hash && actionsAnchor === anchor) {
      actions.close()
      return
    }
    actions.open(torrent.hash)
    setActionsAnchor(anchor)
  }
  const showActionsRef = useRef(showActions)
  useLayoutEffect(() => {
    showActionsRef.current = showActions
  })
  const openActions = useCallback(
    (torrent: Torrent, anchor: HTMLElement) => showActionsRef.current(torrent, anchor),
    [],
  )

  const { toggle: toggleTorrent } = pauseResume
  const toggleRunning = useCallback((torrent: Torrent) => void toggleTorrent(torrent), [toggleTorrent])

  const resetFilters = () => {
    setFilter('all')
    setType('all')
    setQuery('')
  }

  // The count takes the title's place; both buttons sit together on the right, where the select
  // button was, so the pointer is already there.
  const selectionRow = (
    <div className="downloads-title-row">
      <h1 className="t-h3 ks-num" aria-live="polite">
        {t('downloads.selected', { count: selectedVisible.length })}
      </h1>
      <Button
        variant="ghost"
        size="sm"
        disabled={visible.length === 0}
        onClick={() => setSelected(new Set(allSelected ? [] : visible.map((torrent) => torrent.hash)))}
      >
        {allSelected ? t('downloads.selectNone') : t('downloads.selectAll')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
        {t('downloads.selectCancel')}
      </Button>
    </div>
  )

  const selectButton = (
    <IconButton
      icon="select"
      label={t('downloads.select')}
      iconSize={22}
      disabled={offline || torrents.length === 0}
      onClick={() => setSelected(new Set())}
    />
  )

  const totals = (
    <p className="downloads-totals t-cap ks-num c2">
      <span className="downloads-total">
        <Icon name="arrow-down" size={15} className="ca" />
        <span className="sr-only">{t('downloads.downloadSpeed')}</span>
        {server?.dl_info_speed === undefined ? '—' : format.speed(server.dl_info_speed)}
      </span>
      <span className="downloads-total">
        <Icon name="arrow-up" size={15} className="downloads-up" />
        <span className="sr-only">{t('downloads.uploadSpeed')}</span>
        {server?.up_info_speed === undefined ? '—' : format.speed(server.up_info_speed)}
      </span>
      {free !== undefined && (
        <span className="downloads-total downloads-free">
          <Icon name="disk" size={15} />
          {t('downloads.freeSpace', { size: format.size(free) })}
        </span>
      )}
    </p>
  )

  const offlineBanner = offline && data !== null && <OfflineBanner updatedAt={updatedAt} onRetry={refresh} />

  const chips = (
    <div className="downloads-chips ks-hscroll" role="group" aria-label={t('downloads.filtersLabel')}>
      {STATUS_FILTERS.map((key) => (
        <FilterChip
          key={key}
          selected={filter === key}
          count={loading ? undefined : counts[key]}
          onClick={() => setFilter(key)}
        >
          {key === 'all' ? t('downloads.all') : t(`status.${key}`)}
        </FilterChip>
      ))}
    </div>
  )

  const viewSwitch = (
    <Segmented
      label={t('downloads.view')}
      iconsOnly
      options={[
        { value: 'list', label: t('downloads.viewList'), icon: 'list' },
        { value: 'grid', label: t('downloads.viewGrid'), icon: 'grid' },
      ]}
      value={view}
      onChange={setView}
    />
  )

  const header = isDesktop ? (
    // Desktop: the name filter always shows; the status and the sort are menus, so the controls fit one row.
    <header ref={headRef} className="downloads-head">
      {selecting ? (
        selectionRow
      ) : (
        <div className="downloads-title-row">
          <h1 className="t-h1">{t('downloads.title')}</h1>
          {totals}
          <div className="downloads-head-tools">
            <div className="downloads-filter">
              <Input
                icon="search"
                type="search"
                aria-label={t('downloads.search')}
                placeholder={t('downloads.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {selectButton}
          </div>
        </div>
      )}
      {offlineBanner}
      <div className="downloads-toolbar">
        <StatusMenu value={filter} onChange={setFilter} counts={loading ? undefined : counts} />
        <Segmented
          label={t('downloads.type')}
          options={TYPE_FILTERS.map((key) => ({
            value: key,
            label: key === 'all' ? t('downloads.all') : t(`downloads.types.${key}`),
          }))}
          value={type}
          onChange={setType}
        />
        <Button
          variant="secondary"
          size="sm"
          // Its icon shows the direction, upside down for ascending, as the releases' direction button does.
          icon="sort-desc"
          className={cx('downloads-sort', !descending && 'is-ascending')}
          aria-haspopup="menu"
          aria-expanded={sortAnchor !== null}
          aria-label={t('downloads.sortOrderButton', {
            sort: t(`downloads.sorts.${sort}`),
            direction: t(descending ? 'downloads.descending' : 'downloads.ascending'),
          })}
          onClick={(event) => setSortAnchor(sortAnchor ? null : event.currentTarget)}
        >
          {t(`downloads.sorts.${sort}`)}
          <Icon name="chevron-down" size={14} />
        </Button>
        {viewSwitch}
      </div>
    </header>
  ) : (
    // Phone: the title and the totals scroll away, while the bar with the filters, the sort and the
    // view (and the selection's count and buttons, in place of the title) stays at the top.
    <>
      <header className="downloads-head">
        {!selecting && (
          <div className="downloads-title-row">
            <h1 className="t-h1">{t('downloads.title')}</h1>
            <PollRing poll={main.poll} className="downloads-poll" />
            <AltSpeedButton main={main} />
            <IconButton
              icon="search"
              label={t('downloads.search')}
              active={searchOpen}
              iconSize={22}
              onClick={toggleSearch}
            />
            {selectButton}
          </div>
        )}

        {totals}

        {offlineBanner}
      </header>

      <div className="downloads-bar">
        {selecting && selectionRow}

        {searchOpen && (
          <Input
            icon="search"
            type="search"
            aria-label={t('downloads.search')}
            placeholder={t('downloads.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        )}

        {chips}

        <div className="downloads-toolbar">
          <Button
            variant="ghost"
            size="sm"
            icon="sort"
            className="downloads-sort"
            aria-haspopup="dialog"
            aria-label={
              type === 'all'
                ? t('downloads.sortButton', { sort: t(`downloads.sorts.${sort}`) })
                : t('downloads.sortTypeButton', { sort: t(`downloads.sorts.${sort}`), type: t(`downloads.types.${type}`) })
            }
            onClick={() => setSortOpen(true)}
          >
            {t(`downloads.sorts.${sort}`)}
            {type !== 'all' && <Badge className="downloads-type">{t(`downloads.types.${type}`)}</Badge>}
          </Button>
          {viewSwitch}
        </div>
      </div>
    </>
  )

  return (
    <main className="downloads status-strip">
      {header}

      <section className="downloads-body" aria-label={t('downloads.title')} aria-busy={loading}>
        {!loading && <InstallCard />}
        {loading && offline ? (
          <EmptyState
            icon="wifi-off"
            tone="error"
            title={t('offline.unreachableTitle')}
            actionLabel={t('common.retry')}
            onAction={refresh}
          >
            {t('offline.unreachableBody')}
          </EmptyState>
        ) : loading && grid ? (
          <div className="ks-poster-grid" role="status">
            <span className="sr-only">{t('downloads.loading')}</span>
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <PosterCardSkeleton key={index} />
            ))}
          </div>
        ) : loading ? (
          <div className="downloads-list" role="status">
            <span className="sr-only">{t('downloads.loading')}</span>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div key={index} className="ks-dl dl-skeleton" aria-hidden="true">
                <div className="ks-skel dl-skel-poster" />
                <div className="dl-skel-lines">
                  <div className="ks-skel" style={{ height: 14, width: '70%' }} />
                  <div className="ks-skel" style={{ height: 10, width: '92%' }} />
                  <div className="ks-skel" style={{ height: 4, marginTop: 6 }} />
                  <div className="dl-skel-chips">
                    <div className="ks-skel dl-skel-chip" style={{ width: 92 }} />
                    <div className="ks-skel dl-skel-chip" style={{ width: 64 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : torrents.length === 0 ? (
          <EmptyState icon="download" title={t('downloads.emptyTitle')}>
            {t('downloads.emptyBody')}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="filter"
            tone="muted"
            title={t('downloads.noMatchTitle')}
            actionLabel={t('downloads.resetFilters')}
            onAction={resetFilters}
          >
            {t('downloads.noMatchBody')}
          </EmptyState>
        ) : isDesktop && !grid ? (
          <div className={cx('dl-table', (selecting || queueColumn) && 'has-lead')} role="table" aria-label={t('downloads.title')}>
            <div role="rowgroup" className="dl-table-head">
              <DownloadRowHeader
                selecting={selecting}
                queue={queueColumn}
                order={order}
                onSort={(next) => setOrder(clickedOrder(order, next))}
              />
            </div>
            <div role="rowgroup" className="dl-table-body">
              {visible.map((torrent) => (
                <DownloadRow
                  key={torrent.hash}
                  torrent={torrent}
                  match={matches[torrent.hash]}
                  showQueue={queueColumn}
                  onMore={openActions}
                  onToggleRunning={toggleRunning}
                  busy={pauseResume.busy(torrent.hash)}
                  disabled={offline}
                  selected={selected ? selected.has(torrent.hash) : undefined}
                  onToggle={toggleSelected}
                />
              ))}
            </div>
          </div>
        ) : (
          <ul className={grid ? 'ks-poster-grid' : 'downloads-list'}>
            {visible.map((torrent) => {
              const Item = grid ? DownloadCard : DownloadItem
              return (
                <Item
                  key={torrent.hash}
                  torrent={torrent}
                  match={matches[torrent.hash]}
                  showQueue={sort === 'priority'}
                  onMore={openActions}
                  onToggleRunning={isDesktop ? toggleRunning : undefined}
                  busy={pauseResume.busy(torrent.hash)}
                  disabled={offline}
                  selected={selected ? selected.has(torrent.hash) : undefined}
                  onToggle={toggleSelected}
                />
              )
            })}
          </ul>
        )}
      </section>
      {isDesktop && sortAnchor && (
        <SortMenu
          anchor={sortAnchor}
          value={sort}
          onChange={pickSort}
          onClose={() => setSortAnchor(null)}
        />
      )}
      <SortSheet
        open={sortOpen && !isDesktop}
        value={sort}
        onChange={pickSort}
        type={type}
        onTypeChange={setType}
        onClose={() => setSortOpen(false)}
      />
      {actionsTorrent && (
        <TorrentActionsSheet
          torrent={actionsTorrent}
          match={matches[actionsTorrent.hash]}
          guessed={isGuessed(actionsTorrent, serverMatches?.[actionsTorrent.hash])}
          offline={offline}
          anchor={actionsAnchor}
          onClose={() => actions.close()}
          onDelete={() => {
            actions.close()
            remove.open([actionsTorrent])
          }}
          onMove={() => {
            actions.close()
            move.open(actionsTorrent.hash)
          }}
          onRecheck={() => {
            actions.close()
            recheck.open(actionsTorrent.hash)
          }}
          onSpeedLimits={() => {
            actions.close()
            limits.open(actionsTorrent.hash)
          }}
          onChangeTitle={() => {
            actions.close()
            retitle.open(actionsTorrent.hash)
          }}
        />
      )}
      {move.element}
      {retitle.element}
      {selecting && (
        <BulkActionsBar
          torrents={selectedVisible}
          label={t('downloads.selected', { count: selectedVisible.length })}
          offline={offline}
          onDone={() => setSelected(null)}
          onDelete={() => remove.open(selectedVisible)}
        />
      )}
      {recheck.element}
      {limits.element}
      {remove.element}
    </main>
  )
}

/**
 * The phone's alternative speed limits switch in the title row, with a toast when a switch fails.
 * Rendered only on phones, so it owns the switch there; on desktop the sidebar's card does.
 */
function AltSpeedButton({ main }: { main: MainDataState }) {
  const { t } = useTranslation()
  const altSpeed = useAltSpeedSwitch(main)
  if (altSpeed.on === undefined) return null
  return (
    <IconButton
      icon="turtle"
      label={t('speedLimits.alt')}
      active={altSpeed.on}
      disabled={altSpeed.disabled}
      iconSize={22}
      onClick={altSpeed.toggle}
    />
  )
}
