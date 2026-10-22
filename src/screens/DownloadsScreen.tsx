import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Toast } from '../components/Toast'
import { useFormatters } from '../lib/format'
import { STATUS_FILTERS, compareByQueue, matchesFilter, type StatusFilter } from '../torrents/status'
import { useTitleMatches } from '../torrents/titleMatches'
import { useMainData } from '../torrents/useMainData'
import { DeleteTorrentDialog } from './DeleteTorrentDialog'
import { DownloadItem } from './DownloadItem'
import { InstallCard } from './InstallCard'
import { OfflineBanner } from './OfflineBanner'
import { TorrentActionsSheet } from './TorrentActionsSheet'
import './DownloadsScreen.css'

export interface DownloadsScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
}

const SKELETON_ROWS = 5

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
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [actionsFor, setActionsFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Tell the user when qBittorrent answers again after an outage.
  const [wasOffline, setWasOffline] = useState(offline)
  const [reconnected, setReconnected] = useState(false)
  if (offline !== wasOffline) {
    setWasOffline(offline)
    setReconnected(!offline)
  }
  const dismissReconnected = useCallback(() => setReconnected(false), [])

  const torrents = useMemo(() => (data ? Object.values(data.torrents).sort(compareByQueue) : []), [data])
  const matches = useTitleMatches(torrents)
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return torrents.filter(
      (torrent) =>
        matchesFilter(torrent, filter) &&
        (!needle ||
          torrent.name.toLocaleLowerCase().includes(needle) ||
          !!matches[torrent.hash]?.title.toLocaleLowerCase().includes(needle)),
    )
  }, [torrents, filter, query, matches])

  const loading = data === null
  // Looked up on every render, so the sheet follows live status changes and closes if the torrent goes away.
  const actionsTorrent = actionsFor ? data?.torrents[actionsFor] : undefined
  const deleteTorrent = deleting ? data?.torrents[deleting] : undefined
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
          <ul className="downloads-list">
            {visible.map((torrent) => (
              <DownloadItem
                key={torrent.hash}
                torrent={torrent}
                match={matches[torrent.hash]}
                onMore={(target) => setActionsFor(target.hash)}
              />
            ))}
          </ul>
        )}
      </section>
      {actionsTorrent && (
        <TorrentActionsSheet
          torrent={actionsTorrent}
          match={matches[actionsTorrent.hash]}
          offline={offline}
          onClose={() => setActionsFor(null)}
          onChanged={refresh}
          onDelete={() => {
            setActionsFor(null)
            setDeleting(actionsTorrent.hash)
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
