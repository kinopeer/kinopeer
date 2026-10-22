import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
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
import { useRequest } from '../lib/useRequest'
import { useTmdbLanguage } from '../settings/settings'
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

export function TitleScreen() {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const type = params.type === 'movie' || params.type === 'tv' ? params.type : undefined
  const id = Number(params.id)
  const valid = type !== undefined && Number.isInteger(id) && id > 0
  const language = useTmdbLanguage()

  const request = useRequest<Details>(valid ? `${type}|${id}|${language}` : null, async (signal) =>
    type === 'movie'
      ? { type, ...(await getMovie(id, { language, signal })) }
      : { type: 'tv', ...(await getTv(id, { language, signal })) },
  )

  // Opened from inside the app: go back. Opened from a shared link: there's nothing to go back to.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/search'))
  const backButton = (
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
          <EmptyState icon="key" tone="error" title={t('search.keyTitle')}>
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
  const poster = posterUrl(details.poster_path, 'w342')

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
            <h1 className="t-h2 title-name">{name}</h1>
            {originalName && originalName !== name && (
              <p className="t-cap c3" lang={details.original_language}>
                {originalName}
              </p>
            )}
            <p className="t-cap c2 ks-num">{metaLine(t, format, details)}</p>
            {details.vote_count > 0 && (
              <p className="title-rating">
                <Icon name="star" size={16} filled className="title-star" />
                <span className="sr-only">{t('title.rating')}</span>
                <span className="ks-num">{details.vote_average.toLocaleString(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</span>
                <span className="t-cap c3">TMDB</span>
              </p>
            )}
          </div>
        </div>

        {details.genres.length > 0 && (
          <ul className="title-genres">
            {details.genres.map((genre) => (
              <li key={genre.id}>
                <Badge>{genre.name}</Badge>
              </li>
            ))}
          </ul>
        )}

        {details.overview && (
          <section className="title-overview" aria-labelledby="title-overview">
            <h2 id="title-overview" className="t-h3">
              {t('title.overview')}
            </h2>
            <p className="t-body c2">{details.overview}</p>
          </section>
        )}
        {details.type === 'tv' && <Banner tone="info">{t('title.seriesHint')}</Banner>}
      </div>
      <div className="title-actions">
        <Button size="lg" icon="search" block onClick={() => navigate(`/title/${details.type}/${details.id}/releases`)}>
          {t('title.findReleases')}
        </Button>
      </div>
    </main>
  )
}
