import type { TFunction } from 'i18next'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useMatch, useNavigate, useParams } from 'react-router'
import {
  TmdbError,
  TmdbKeyError,
  getMovie,
  getTv,
  posterUrl,
  type MovieDetails,
  type TvDetails,
} from '../api/tmdb'
import { Badge } from '../components/Badge'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { useFormatters, type Formatters } from '../lib/format'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useRequest } from '../lib/useRequest'
import { useTmdbLanguage } from '../settings/settings'
import { useTitleTorrents } from '../torrents/titleMatches'
import { useMainData } from '../torrents/useMainData'
import { ReleasesScreen } from './ReleasesScreen'
import type { SettingsLocationState } from './SettingsScreen'
import { TitleDownloads } from './TitleDownloads'
import { TitleOverview } from './TitleOverview'
import { TitleRelated } from './TitleRelated'
import { TitleReleases } from './TitleReleases'
import './TitleScreen.css'

type Details = ({ type: 'movie' } & MovieDetails) | ({ type: 'tv' } & TvDetails)

function year(date: string | null | undefined): string | undefined {
  return date ? date.slice(0, 4) : undefined
}

/** "2024 · 2h 46m" for a movie, "2022–2025 · 2 seasons · 24 episodes" for a series. */
function metaLine(t: TFunction, format: Formatters, details: Details): string {
  if (details.type === 'movie') {
    return [year(details.release_date), details.runtime ? format.duration(details.runtime * 60) : undefined]
      .filter(Boolean)
      .join(' · ')
  }
  const from = year(details.first_air_date)
  const to = year(details.last_air_date)
  const years = !from
    ? undefined
    : details.in_production
      ? t('title.yearsOngoing', { from })
      : to && to !== from
        ? `${from}–${to}`
        : from
  return [
    years,
    details.number_of_seasons ? t('title.seasons', { count: details.number_of_seasons }) : undefined,
    details.number_of_episodes ? t('title.episodes', { count: details.number_of_episodes }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

const RELEASES_PATH = '/title/:type/:id/releases'

export interface TitleScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
}

export interface TitleLocationState {
  /** The title page was opened from a link, so Back has nowhere to go in the app. */
  deepLink?: boolean
}

/**
 * The title's routes. On a phone its releases are a screen of their own; on desktop they're on the
 * title page, under the hero, and the releases path opens it with them searched.
 */
export function TitleRoute({ onSessionLost }: TitleScreenProps) {
  const desktop = useIsDesktop()
  const releases = useMatch(RELEASES_PATH) !== null
  return releases && !desktop ? <ReleasesScreen /> : <TitleScreen onSessionLost={onSessionLost} />
}

export function TitleScreen({ onSessionLost }: TitleScreenProps) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const type = params.type === 'movie' || params.type === 'tv' ? params.type : undefined
  const id = Number(params.id)
  const valid = type !== undefined && Number.isInteger(id) && id > 0
  const language = useTmdbLanguage()
  const desktop = useIsDesktop()
  // On desktop the releases path is the title page with its releases searched.
  const searched = useMatch(RELEASES_PATH) !== null && desktop
  const releasesRef = useRef<HTMLElement>(null)

  // The title's torrents. While qBittorrent doesn't answer, the last known ones stay.
  const { data } = useMainData(onSessionLost)
  const torrents = useMemo(() => (data ? Object.values(data.torrents) : []), [data])
  const downloads = useTitleTorrents(torrents, type ?? 'movie', valid ? id : 0)

  const request = useRequest<Details>(valid ? `${type}|${id}|${language}` : null, async (signal) =>
    type === 'movie'
      ? { ...(await getMovie(id, { language, signal })), type }
      : { ...(await getTv(id, { language, signal })), type: 'tv' },
  )

  // Opened from inside the app: go back. Opened from a shared link: there's nothing to go back to.
  const deepLink = location.key === 'default' || (location.state as TitleLocationState | null)?.deepLink === true
  const goBack = () => (deepLink ? navigate('/search') : navigate(-1))

  const scrollToReleases = (behavior: ScrollBehavior = 'smooth') =>
    releasesRef.current?.scrollIntoView?.({
      block: 'start',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior,
    })
  const hasDetails = request.data !== undefined
  // The page opened at the releases' address (a link, a reload, Back to it), so it starts at them.
  const openedAtReleases = useRef(searched)
  // The releases appear once searched: show them. From the button, the page scrolls down to them.
  // Opened at their address, it jumps there before it's painted: the user hasn't seen the hero, so
  // there's nothing to scroll from, and a smooth scroll while the page is still loading is fragile
  // (layout shifts from fonts and images, and the browser's own scrolling on load, cut it short).
  useLayoutEffect(() => {
    if (!searched || !hasDetails) return
    const instant = openedAtReleases.current
    openedAtReleases.current = false
    scrollToReleases(instant ? 'auto' : 'smooth')
  }, [searched, hasDetails])

  const findReleases = () => {
    if (!desktop) return navigate(`/title/${type}/${id}/releases`)
    if (searched) return scrollToReleases()
    // The releases are part of the page, so Back still leaves it rather than hiding them.
    navigate(`/title/${type}/${id}/releases`, { replace: true, state: { deepLink } satisfies TitleLocationState })
  }

  const backButton = desktop ? (
    <Button variant="ghost" size="sm" icon="chevron-left" className="title-dback" onClick={goBack}>
      {t('title.back')}
    </Button>
  ) : (
    <IconButton
      icon="chevron-left"
      variant="glass"
      label={t('title.back')}
      iconSize={24}
      className="title-back"
      onClick={goBack}
    />
  )

  const notFound = !valid || (request.error instanceof TmdbError && request.error.status === 404)
  if (notFound || request.error) {
    return (
      <main className="title title-message">
        {backButton}
        {notFound ? (
          <EmptyState
            icon="film"
            tone="muted"
            title={t('title.notFoundTitle')}
            actionLabel={t('title.backToSearch')}
            onAction={() => navigate('/search')}
          >
            {t('title.notFoundBody')}
          </EmptyState>
        ) : request.error instanceof TmdbKeyError ? (
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
        )}
      </main>
    )
  }

  const details = request.data
  if (!details && desktop) {
    return (
      <main className="title title-desktop" aria-busy="true">
        <div className="title-dhero">
          {backButton}
          <div className="title-dhead" role="status">
            <span className="sr-only">{t('title.loading')}</span>
            <div className="ks-skel title-dposter title-skel-poster" aria-hidden="true" />
            <div className="title-dtext" aria-hidden="true">
              <div className="ks-skel" style={{ height: 46, width: '60%' }} />
              <div className="ks-skel" style={{ height: 16, width: '40%' }} />
              <div className="ks-skel" style={{ height: 52, width: '80%' }} />
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!details) {
    return (
      <main className="title" aria-busy="true">
        {backButton}
        <div className="title-hero" />
        <div className="title-body" role="status">
          <span className="sr-only">{t('title.loading')}</span>
          <div className="title-head" aria-hidden="true">
            <div className="ks-skel title-poster title-skel-poster" />
            <div className="title-head-text">
              <div className="ks-skel" style={{ height: 24, width: '80%' }} />
              <div className="ks-skel" style={{ height: 14, width: '50%' }} />
            </div>
          </div>
        </div>
      </main>
    )
  }

  const name = details.type === 'movie' ? details.title : details.name
  const originalName = details.type === 'movie' ? details.original_title : details.original_name
  const poster = posterUrl(details.poster_path, desktop ? 'w500' : 'w342')
  const inDownloads = downloads.length > 0 && (
    <Badge kind="coverage" icon="check" className="title-in-dl">
      {t('title.inDownloadsBadge', {
        value: downloads.length > 1 ? downloads.length : format.percent(downloads[0].progress),
      })}
    </Badge>
  )
  const rating = details.vote_count > 0 && (
    <p className="t-label title-rating">
      <Icon name="star" size={16} filled className="title-star" />
      <span className="sr-only">{t('title.rating')}</span>
      <span className="ks-num">{details.vote_average.toLocaleString(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</span>
      <span className="t-cap c3">TMDB</span>
    </p>
  )
  const genres = details.genres.length > 0 && (
    <ul className="title-genres">
      {details.genres.map((genre) => (
        <li key={genre.id}>
          <Badge>{genre.name}</Badge>
        </li>
      ))}
    </ul>
  )

  if (desktop) {
    return (
      <main className="title title-desktop">
        <div className="title-dhero">
          {poster && <img src={poster} alt="" className="title-dhero-art" aria-hidden="true" />}
          <div className="title-hero-fade" aria-hidden="true" />
          {backButton}
          <div className="title-dhead">
            <Poster src={poster} className="title-dposter" />
            <div className="title-dtext">
              {inDownloads}
              <h1 className="t-display title-dname">{name}</h1>
              <div className="title-dmeta">
                {originalName && originalName !== name && (
                  <p className="t-label c2" lang={details.original_language}>
                    {originalName}
                  </p>
                )}
                <p className="t-label c2 ks-num">{metaLine(t, format, details)}</p>
                {rating}
                {genres}
              </div>
              {details.overview && <TitleOverview key={`${details.type}:${details.id}`} text={details.overview} />}
              <div className="title-dactions">
                <Button size="lg" icon={searched ? 'arrow-down' : 'search'} onClick={findReleases}>
                  {t('title.findReleases')}
                </Button>
                {details.type === 'tv' && <p className="t-cap c2 title-dhint">{t('title.seriesHint')}</p>}
              </div>
            </div>
          </div>
        </div>
        <TitleDownloads torrents={downloads} />
        {searched && <TitleReleases details={details} sectionRef={releasesRef} />}
        <TitleRelated type={details.type} id={details.id} language={language} />
      </main>
    )
  }

  return (
    <main className="title">
      {backButton}
      <div className="title-hero" aria-hidden="true">
        {poster && <img src={poster} alt="" className="title-hero-art" />}
        <div className="title-hero-fade" />
      </div>
      <div className="title-body">
        <div className="title-head">
          <Poster src={poster} className="title-poster" />
          <div className="title-head-text">
            {inDownloads}
            <h1 className="t-h2 title-name">{name}</h1>
            {originalName && originalName !== name && (
              <p className="t-cap c3" lang={details.original_language}>
                {originalName}
              </p>
            )}
            <p className="t-cap c2 ks-num">{metaLine(t, format, details)}</p>
            {rating}
          </div>
        </div>

        {genres}

        {details.overview && (
          <section className="title-overview" aria-labelledby="title-overview">
            <h2 id="title-overview" className="t-h3">
              {t('title.overview')}
            </h2>
            <p className="t-body c2">{details.overview}</p>
          </section>
        )}
        <TitleDownloads torrents={downloads} />
        {details.type === 'tv' && <Banner tone="info">{t('title.seriesHint')}</Banner>}
        <TitleRelated type={details.type} id={details.id} language={language} />
      </div>
      <div className="title-actions">
        <Button size="lg" icon="search" block onClick={findReleases}>
          {t('title.findReleases')}
        </Button>
      </div>
    </main>
  )
}
