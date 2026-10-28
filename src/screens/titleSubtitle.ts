import type { TFunction } from 'i18next'
import type { Title } from '../api/tmdb'

/** "Movie · 2024", or just the type when the year is unknown. */
export function titleSubtitle(t: TFunction, title: Title): string {
  const type = t(title.type === 'movie' ? 'title.movie' : 'title.series')
  return title.year ? t('title.subtitle', { type, year: title.year }) : type
}
