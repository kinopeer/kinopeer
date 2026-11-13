import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { TmdbKeyError, posterUrl, searchTitles, type MediaType, type Title } from '../api/tmdb'
import { Banner } from '../components/Banner'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useRequest } from '../lib/useRequest'
import { useTmdbLanguage } from '../settings/settings'
import { parseName } from '../torrents/parseName'
import { sameTitle, type TitleMatch } from '../torrents/titleMatches'
import { SEARCH_DEBOUNCE_MS } from './SearchScreen'
import './ChangeTitleSheet.css'

type TypeFilter = 'all' | MediaType

export interface ChangeTitleSheetProps {
  torrent: Pick<Torrent, 'hash' | 'name'>
  /** The title shown for the torrent now, if any. */
  current?: TitleMatch | null
  /** A title being saved for the torrent, picked here or elsewhere: every pick is off meanwhile. */
  saving?: Pick<TitleMatch, 'type' | 'id'>
  /** The last save failed while this showed the torrent. */
  failed: boolean
  onPick: (title: Title) => void
  onClose: () => void
}

function details(t: TFunction, title: Title): string {
  const original = title.originalTitle && title.originalTitle !== title.title ? title.originalTitle : undefined
  return [t(title.type === 'movie' ? 'title.movie' : 'title.series'), title.year, original].filter(Boolean).join(' · ')
}

/**
 * Finds the torrent's title in TMDB, starting from the name guessed from the release, for the user
 * to pick. `useChangeTitle` renders it and saves the pick on the Kinopeer server as their choice.
 */
export function ChangeTitleSheet({ torrent, current, saving, failed, onPick, onClose }: ChangeTitleSheetProps) {
  const { t } = useTranslation()
  const language = useTmdbLanguage()
  const [query, setQuery] = useState(() => parseName(torrent.name).title)
  const [type, setType] = useState<TypeFilter>('all')

  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const search = useRequest(term ? `retitle|${language}|${term}` : null, (signal) =>
    searchTitles(term, { language, signal }),
  )
  const isCurrent = (title: Title) => sameTitle(title, current)
  const results = (search.data?.titles ?? [])
    .filter((title) => type === 'all' || title.type === type)
    .sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)))
  const loading = !!query.trim() && (search.loading || term !== query.trim())

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('match.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('common.cancel')} onClick={onClose} />}
      footer={<p className="t-cap c3 retitle-hint">{t('match.hint')}</p>}
      size="lg"
      className="retitle-sheet"
    >
      <div className="retitle-controls">
        <div className="search-field">
          <Input
            icon="search"
            type="search"
            aria-label={t('match.searchLabel')}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <IconButton
              icon="close"
              label={t('search.clear')}
              iconSize={18}
              className="search-clear"
              onClick={() => setQuery('')}
            />
          )}
        </div>
        <Segmented
          label={t('common.type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'movie', label: t('types.movie') },
            { value: 'tv', label: t('types.tv') },
          ]}
        />
        {failed && <Banner tone="error">{t('match.saveFailed')}</Banner>}
      </div>

      <div className="retitle-results" aria-busy={loading}>
        {!query.trim() ? null : search.error ? (
          <EmptyState
            icon={search.error instanceof TmdbKeyError ? 'key' : 'wifi-off'}
            tone="error"
            title={t('search.errorTitle')}
            actionLabel={t('common.retry')}
            onAction={search.retry}
          >
            {search.error instanceof TmdbKeyError ? t('search.keyBody') : t('search.errorBody')}
          </EmptyState>
        ) : loading ? (
          <div role="status" className="retitle-loading">
            <span className="sr-only">{t('search.loading')}</span>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="ks-skel retitle-skel" aria-hidden="true" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState icon="search" tone="muted" title={t('match.nothingFound')}>
            {t('search.noResultsBody')}
          </EmptyState>
        ) : (
          <ul className="retitle-list">
            {results.map((title) => {
              const key = `${title.type}:${title.id}`
              const poster = posterUrl(title.posterPath, 'w185')
              const selected = isCurrent(title)
              const busy = sameTitle(title, saving)
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="ks-row-btn retitle-row"
                    aria-current={selected || undefined}
                    aria-busy={busy || undefined}
                    disabled={saving !== undefined}
                    onClick={() => onPick(title)}
                  >
                    <span className="ks-poster retitle-poster">
                      {poster ? (
                        <img className="ks-poster-art" src={poster} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="ks-poster-art ks-poster-none">
                          <Icon name="film" size={18} />
                        </span>
                      )}
                    </span>
                    <span className="retitle-text">
                      <span className="t-label ks-trunc retitle-name">{title.title}</span>{' '}
                      <span className="t-cap c3 ks-num ks-trunc">{details(t, title)}</span>
                    </span>{' '}
                    {busy ? (
                      <span className="ks-spin" aria-hidden="true" />
                    ) : (
                      selected && (
                        <span className="t-cap ca retitle-current">
                          <Icon name="check" size={16} />
                          {t('match.current')}
                        </span>
                      )
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
