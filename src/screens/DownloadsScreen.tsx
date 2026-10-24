import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { PosterCardSkeleton } from '../components/PosterCard'
import { Segmented } from '../components/Segmented'
import { Toast } from '../components/Toast'
import { useFormatters } from '../lib/format'
import { useSettings } from '../settings/settings'
import { compareTorrents, knownSort } from '../torrents/sort'
import { STATUS_FILTERS, matchesFilter, type StatusFilter } from '../torrents/status'
import { useServerMatches } from '../torrents/serverMatches'
import { isGuessed, useTitleMatches } from '../torrents/titleMatches'
import { useMainData } from '../torrents/useMainData'
import { ChangeTitleSheet } from './ChangeTitleSheet'
import { DeleteTorrentDialog } from './DeleteTorrentDialog'
import { DownloadCard } from './DownloadCard'
import { DownloadItem } from './DownloadItem'
import { InstallCard } from './InstallCard'
import { OfflineBanner } from './OfflineBanner'
import { SortSheet } from './SortSheet'
import { TorrentActionsSheet } from './TorrentActionsSheet'
import './DownloadsScreen.css'

export interface DownloadsScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
}

const SKELETON_ROWS = 5
const SKELETON_CARDS = 4

export function DownloadsScreen({ onSessionLost }: DownloadsScreenProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const { data, offline, updatedAt, refresh } = useMainData(onSessionLost)
  const location = useLocation()
  const navigate = useNavigate()
  // Set by the releases screen after adding a release, and by the torrent screen after deleting one.
  const { added, deleted } = (location.state ?? {}) as { added?: string; deleted?: 'torrent' | 'files' }
  const dismissToast = useCallback(
    () => void navigate(location.pathname, { replace: true, state: null }),
    [navigate, location.pathname],
  )
  const [{ downloadsView: view, downloadsSort }, updateSettings] = useSettings()
  const grid = view === 'grid'
  const sort = knownSort(downloadsSort)
  const [sortOpen, setSortOpen] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [actionsFor, setActionsFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [retitling, setRetitling] = useState<string | null>(null)
  const [titleSaved, setTitleSaved] = useState<'changed' | 'confirmed' | null>(null)
  const dismissTitleSaved = useCallback(() => setTitleSaved(null), [])
  // Tell the user when qBittorrent answers again after an outage.
  const [wasOffline, setWasOffline] = useState(offline)
  const [reconnected, setReconnected] = useState(false)
  if (offline !== wasOffline) {
    setWasOffline(offline)
    setReconnected(!offline)
  }
  const dismissReconnected = useCallback(() => setReconnected(false), [])

  const torrents = useMemo(() => (data ? Object.values(data.torrents) : []), [data])
  const matches = useTitleMatches(torrents)
  const serverMatches = useServerMatches()
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return torrents
      .filter(
        (torrent) =>
          matchesFilter(torrent, filter) &&
          (!needle ||
            torrent.name.toLocaleLowerCase().includes(needle) ||
            !!matches[torrent.hash]?.title.toLocaleLowerCase().includes(needle)),
      )
      .sort(compareTorrents(sort, (torrent) => matches[torrent.hash]?.title ?? torrent.name))
  }, [torrents, filter, query, matches, sort])

  const loading = data === null
  // Looked up on every render, so the sheet follows live status changes and closes if the torrent goes away.
  const actionsTorrent = actionsFor ? data?.torrents[actionsFor] : undefined
  const deleteTorrent = deleting ? data?.torrents[deleting] : undefined
  const retitleTorrent = retitling ? data?.torrents[retitling] : undefined
  const nameOf = (torrent: Torrent) => matches[torrent.hash]?.title ?? torrent.name
  const server = data?.server

  const toggleSearch = () => {
    setSearchOpen((open) => !open)
    setQuery('')
  }

  const resetFilters = () => {
    setFilter('all')
    setQuery('')
  }

  return (
    <main className="downloads">
      <header className="downloads-head">
        <div className="downloads-title-row">
          <h1 className="t-h1">{t('downloads.title')}</h1>
          <IconButton
            icon="search"
            label={t('downloads.search')}
            active={searchOpen}
            iconSize={22}
            onClick={toggleSearch}
          />
        </div>

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
          {server?.free_space_on_disk !== undefined && (
            <span className="downloads-total downloads-free">
              <Icon name="disk" size={15} />
              {t('downloads.freeSpace', { size: format.size(server.free_space_on_disk) })}
            </span>
          )}
        </p>

        {offline && data !== null && <OfflineBanner updatedAt={updatedAt} onRetry={refresh} />}

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

        <div className="downloads-chips ks-hscroll" role="group" aria-label={t('downloads.filtersLabel')}>
          {STATUS_FILTERS.map((key) => (
            <FilterChip
              key={key}
              selected={filter === key}
              count={loading ? undefined : torrents.filter((torrent) => matchesFilter(torrent, key)).length}
              onClick={() => setFilter(key)}
            >
              {key === 'all' ? t('downloads.all') : t(`status.${key}`)}
            </FilterChip>
          ))}
        </div>

        <div className="downloads-toolbar">
          <Button
            variant="ghost"
            size="sm"
            icon="sort"
            className="downloads-sort"
            aria-haspopup="dialog"
            aria-label={t('downloads.sortButton', { sort: t(`downloads.sorts.${sort}`) })}
            onClick={() => setSortOpen(true)}
          >
            {t(`downloads.sorts.${sort}`)}
          </Button>
          <Segmented
            label={t('downloads.view')}
            iconsOnly
            options={[
              { value: 'list', label: t('downloads.viewList'), icon: 'list' },
              { value: 'grid', label: t('downloads.viewGrid'), icon: 'grid' },
            ]}
            value={view}
            onChange={(downloadsView) => updateSettings({ downloadsView })}
          />
        </div>
      </header>

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
                  onMore={(target) => setActionsFor(target.hash)}
                />
              )
            })}
          </ul>
        )}
      </section>
      <SortSheet
        open={sortOpen}
        value={sort}
        onChange={(downloadsSort) => updateSettings({ downloadsSort })}
        onClose={() => setSortOpen(false)}
      />
      {actionsTorrent && (
        <TorrentActionsSheet
          torrent={actionsTorrent}
          match={matches[actionsTorrent.hash]}
          guessed={isGuessed(actionsTorrent, serverMatches?.[actionsTorrent.hash])}
          offline={offline}
          onClose={() => setActionsFor(null)}
          onChanged={refresh}
          onDelete={() => {
            setActionsFor(null)
            setDeleting(actionsTorrent.hash)
          }}
          onChangeTitle={() => {
            setActionsFor(null)
            setRetitling(actionsTorrent.hash)
          }}
          onConfirmed={() => {
            setActionsFor(null)
            setTitleSaved('confirmed')
          }}
        />
      )}
      {retitleTorrent && (
        <ChangeTitleSheet
          torrent={retitleTorrent}
          current={matches[retitleTorrent.hash]}
          onClose={() => setRetitling(null)}
          onChosen={(result) => {
            setRetitling(null)
            setTitleSaved(result)
          }}
        />
      )}
      {deleteTorrent && (
        <DeleteTorrentDialog
          torrent={deleteTorrent}
          title={nameOf(deleteTorrent)}
          onClose={() => setDeleting(null)}
          onDeleted={(withFiles) => {
            setDeleting(null)
            refresh()
            void navigate(location.pathname, { replace: true, state: { deleted: withFiles ? 'files' : 'torrent' } })
          }}
        />
      )}
      {reconnected && <Toast message={t('offline.reconnected')} onDismiss={dismissReconnected} />}
      {titleSaved && (
        <Toast
          message={titleSaved === 'confirmed' ? t('match.confirmed') : t('match.changed')}
          onDismiss={dismissTitleSaved}
        />
      )}
      {added && <Toast message={t('add.added', { title: added })} onDismiss={dismissToast} />}
      {deleted && (
        <Toast
          message={deleted === 'files' ? t('downloads.deletedFiles') : t('downloads.deleted')}
          onDismiss={dismissToast}
        />
      )}
    </main>
  )
}
