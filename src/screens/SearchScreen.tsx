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
import { isYearOutOfRange, parseYear } from '../search/year'
import { useTmdbLanguage } from '../settings/settings'
import { PosterRow } from './PosterRow'
import type { SettingsLocationState } from './SettingsScreen'
import './SearchScreen.css'
import { titleSubtitle } from './titleSubtitle'

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
}

/** A row whose query fails is left out; the screen shows an error only when every row fails or the key is wrong. */
async function loadBrowseRows(language: string, signal: AbortSignal): Promise<BrowseRow[]> {
  const results = await Promise.allSettled(
    browseRowQueries(new Date()).map(async ({ params, ...row }) => ({
      ...row,
      titles: (await discoverTitles(row.type, params, { language, signal })).titles,
    })),
  )
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []))
  const keyError = failures.find((reason) => reason instanceof TmdbKeyError)
  if (keyError) throw keyError
  if (failures.length === results.length) throw failures[0]
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

function parseType(value: string | null): TypeFilter {
  return value === 'movie' || value === 'tv' ? value : 'all'
}

export function SearchScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const type = parseType(params.get('type'))
  const yearText = params.get('year') ?? ''
  const language = useTmdbLanguage()

  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const year = parseYear(useDebouncedValue(yearText, SEARCH_DEBOUNCE_MS))
  const searching = query.trim().length > 0
  const search = useRequest(searching && term ? `search|${language}|${term}|${year ?? ''}` : null, (signal) =>
    searchTitles(term, { language, signal, year }),
  )
  const browse = useRequest(searching ? null : `browse|${language}`, (signal) => loadBrowseRows(language, signal))

  // Kept in the URL so going back to search restores the query and filter.
  const update = (changes: { q?: string; type?: TypeFilter; year?: string }) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const matchesType = (title: Title) => type === 'all' || title.type === type
  const results = search.data?.titles.filter(matchesType) ?? []
  const rows = (browse.data ?? []).filter((row) => type === 'all' || row.type === type)
  const request = searching ? search : browse
  // Between a keystroke and the debounced request there's nothing to show for the new query yet.
  const loading = request.loading || (searching && (term !== query.trim() || year !== parseYear(yearText)))
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
            // An emptied query starts over, as the clear button does.
            onChange={(event) => update({ q: event.target.value, ...(event.target.value.trim() ? {} : { year: '' }) })}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <IconButton
              icon="close"
              label={t('search.clear')}
              iconSize={18}
              className="search-clear"
              onClick={() => update({ q: '', year: '' })}
            />
          )}
        </div>
        <div className="search-filters">
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
          {/* The browse rows are what's popular now, so the year only filters a search. */}
          {searching && (
            // A label around the field makes the whole height of the tabs' row its touch target.
            <label className="search-year">
              <Input
                aria-label={t('search.yearLabel')}
                placeholder={t('search.year')}
                value={yearText}
                error={isYearOutOfRange(yearText)}
                onChange={(event) => update({ year: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                inputMode="numeric"
                enterKeyHint="search"
                autoComplete="off"
              />
            </label>
          )}
        </div>
      </header>

      <section className="search-body" aria-busy={loading}>
        {request.error ? (
          request.error instanceof TmdbKeyError ? (
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
                      subtitle={titleSubtitle(t, title)}
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
              actionLabel={t(year === undefined ? 'search.clear' : 'search.clearYear')}
              onAction={() => update(year === undefined ? { q: '', year: '' } : { year: '' })}
            >
              {year === undefined ? t('search.noResultsBody') : t('search.noResultsYearBody', { year })}
            </EmptyState>
          )
        ) : (
          rows.map((row) => (
            <PosterRow key={row.key} id={`search-row-${row.key}`} heading={t(`search.${row.key}`)} titles={row.titles} />
          ))
        )}
      </section>
    </main>
  )
}
