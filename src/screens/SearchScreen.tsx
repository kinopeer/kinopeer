import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import {
  TmdbKeyError,
  discoverTitles,
  posterUrl,
  searchTitles,
  type MediaType,
  type Title,
} from '../api/tmdb'
import { EmptyState } from '../components/EmptyState'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import { PosterCard, PosterCardSkeleton } from '../components/PosterCard'
import { cx } from '../lib/cx'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useRequest } from '../lib/useRequest'
import { useScrollRestoration } from '../lib/useScrollRestoration'
import { browseRowQueries, type BrowseRowQuery } from '../search/browseRows'
import { useTmdbLanguage } from '../settings/settings'
import type { SettingsLocationState } from './SettingsScreen'
import './SearchScreen.css'

type TypeFilter = 'all' | MediaType

const TYPE_FILTERS = [
  { value: 'all', label: 'search.all' },
  { value: 'movie', label: 'search.movies' },
  { value: 'tv', label: 'search.series' },
] as const

/** Wait this long after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 350

interface BrowseRow extends Omit<BrowseRowQuery, 'params'> {
  titles: Title[]
  /** Why its query failed: it has no titles and shows only as this error when no other row is left. */
  error?: unknown
}

/**
 * Loads every row. An empty one is left out, a failed one comes back with its error and no titles.
 * Throws a key error from any row, so a wrong key shows the key screen, and throws when every row
 * fails.
 */
async function loadBrowseRows(language: string, signal: AbortSignal): Promise<BrowseRow[]> {
  const queries = browseRowQueries(new Date())
  const results = await Promise.allSettled(
    queries.map(({ type, params }) => discoverTitles(type, params, { language, signal })),
  )
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []))
  const keyError = failures.find((reason) => reason instanceof TmdbKeyError)
  if (keyError) throw keyError
  if (failures.length === results.length) throw failures[0]
  return queries
    .map(({ key, type }, index): BrowseRow => {
      const result = results[index]
      return result.status === 'fulfilled'
        ? { key, type, titles: result.value.titles }
        : { key, type, titles: [], error: result.reason }
    })
    .filter((row) => row.error !== undefined || row.titles.length > 0)
}

function parseType(value: string | null): TypeFilter {
  return value === 'movie' || value === 'tv' ? value : 'all'
}

function subtitle(t: TFunction, title: Title): string {
  const type = t(title.type === 'movie' ? 'title.movie' : 'title.series')
  return title.year ? t('title.subtitle', { type, year: title.year }) : type
}

export function SearchScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const type = parseType(params.get('type'))
  const language = useTmdbLanguage()

  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const searching = query.trim().length > 0
  const search = useRequest(searching && term ? `search|${language}|${term}` : null, (signal) =>
    searchTitles(term, { language, signal }),
  )
  const browse = useRequest(searching ? null : `browse|${language}`, (signal) => loadBrowseRows(language, signal))

  // Kept in the URL so going back to search restores the query and filter.
  const update = (changes: { q?: string; type?: TypeFilter }) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const matchesType = (title: Title) => type === 'all' || title.type === type
  const results = search.data?.titles.filter(matchesType) ?? []
  const typeRows = (browse.data ?? []).filter((row) => type === 'all' || row.type === type)
  // A failed row has nothing to show, not even its heading.
  const rows = typeRows.filter((row) => row.error === undefined)
  const request = searching ? search : browse
  // Nothing left because the type's rows failed, not because TMDB had nothing: their error, not "nothing to suggest".
  const error = request.error ?? (rows.length === 0 ? typeRows.find((row) => row.error !== undefined)?.error : undefined)
  // Between a keystroke and the debounced request there's nothing to show for the new query yet.
  const loading = request.loading || (searching && term !== query.trim())
  // Back from a title: the results load again, so the browser can't bring the scroll back itself.
  useScrollRestoration(!loading)

  return (
    <main className="search">
      <header className="search-head">
        <h1 className="t-h1 search-title">{t('search.title')}</h1>
        <div className="search-field">
          <Input
            icon="search"
            type="search"
            aria-label={t('search.title')}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => update({ q: event.target.value })}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <IconButton
              icon="close"
              label={t('search.clear')}
              iconSize={18}
              className="search-clear"
              onClick={() => update({ q: '' })}
            />
          )}
        </div>
        <div className="ks-tabs search-types" role="group" aria-label={t('search.typeLabel')}>
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={cx(type === filter.value && 'is-on')}
              aria-pressed={type === filter.value}
              onClick={() => update({ type: filter.value })}
            >
              {t(filter.label)}
            </button>
          ))}
        </div>
      </header>

      <section className="search-body" aria-busy={loading}>
        {error ? (
          error instanceof TmdbKeyError ? (
            <EmptyState
              icon="key"
              tone="error"
              title={t('search.keyTitle')}
              actionLabel={t('tmdbKey.enter')}
              onAction={() => navigate('/settings', { state: { editTmdbKey: true } satisfies SettingsLocationState })}
            >
              {t('search.keyBody')}
            </EmptyState>
          ) : (
            <EmptyState
              icon="wifi-off"
              tone="error"
              title={t('search.errorTitle')}
              actionLabel={t('common.retry')}
              onAction={request.retry}
            >
              {t('search.errorBody')}
            </EmptyState>
          )
        ) : loading ? (
          <div className="ks-poster-grid" role="status">
            <span className="sr-only">{t('search.loading')}</span>
            {Array.from({ length: 6 }, (_, index) => (
              <PosterCardSkeleton key={index} />
            ))}
          </div>
        ) : searching ? (
          results.length > 0 ? (
            <>
              <p className="t-cap c3 ks-num search-count">{t('search.results', { count: results.length })}</p>
              <ul className="ks-poster-grid">
                {results.map((title) => (
                  <li key={`${title.type}-${title.id}`}>
                    <PosterCard
                      title={title.title}
                      subtitle={subtitle(t, title)}
                      posterUrl={posterUrl(title.posterPath, 'w342')}
                      to={`/title/${title.type}/${title.id}`}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              icon="search"
              tone="muted"
              title={t('search.noResultsTitle', { query: query.trim() })}
              actionLabel={t('search.clear')}
              onAction={() => update({ q: '' })}
            >
              {t('search.noResultsBody')}
            </EmptyState>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            icon="search"
            tone="muted"
            title={t('search.browseEmptyTitle')}
            actionLabel={t('common.retry')}
            onAction={request.retry}
          >
            {t('search.browseEmptyBody')}
          </EmptyState>
        ) : (
          rows.map((row) => (
            <section key={row.key} className="search-row" aria-labelledby={`search-row-${row.key}`}>
              <h2 id={`search-row-${row.key}`} className="t-h3 search-row-title">
                {t(`search.${row.key}`)}
              </h2>
              <ul className="search-row-list ks-hscroll">
                {row.titles.map((title) => (
                  <li key={`${title.type}-${title.id}`}>
                    <PosterCard
                      title={title.title}
                      subtitle={subtitle(t, title)}
                      posterUrl={posterUrl(title.posterPath, 'w342')}
                      to={`/title/${title.type}/${title.id}`}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </main>
  )
}
