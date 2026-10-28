import { useTranslation } from 'react-i18next'
import { getRecommendations, getSimilar, type MediaType, type Title } from '../api/tmdb'
import { useRequest } from '../lib/useRequest'
import { PosterRow } from './PosterRow'

interface Related {
  kind: 'recommendations' | 'similar'
  titles: Title[]
}

export interface TitleRelatedProps {
  type: MediaType
  id: number
  /** TMDB language tag. */
  language: string
}

/**
 * What to watch next, under the title: TMDB's recommendations, or similar titles when it has none.
 * It's an extra on the page, so while it loads, when it fails or when both lists are empty there's
 * nothing here at all.
 */
export function TitleRelated({ type, id, language }: TitleRelatedProps) {
  const { t } = useTranslation()
  const request = useRequest<Related>(`${type}|${id}|${language}|related`, async (signal) => {
    const recommended = await getRecommendations(type, id, { language, signal })
    if (recommended.titles.length > 0) return { kind: 'recommendations', titles: recommended.titles }
    return { kind: 'similar', titles: (await getSimilar(type, id, { language, signal })).titles }
  })
  // TMDB can list the title among its own similar ones.
  const titles = request.data?.titles.filter((title) => title.id !== id) ?? []
  if (!request.data || titles.length === 0) return null
  return (
    <PosterRow
      id="title-related"
      heading={t(request.data.kind === 'recommendations' ? 'title.recommendations' : 'title.similar')}
      titles={titles}
    />
  )
}
