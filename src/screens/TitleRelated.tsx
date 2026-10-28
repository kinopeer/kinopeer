import { useTranslation } from 'react-i18next'
import { getRecommendations, getSimilar, type MediaType, type Title, type TitlePage } from '../api/tmdb'
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
    // TMDB can list the title among its own, so it's left out before deciding whether to fall back.
    const others = (page: TitlePage) => page.titles.filter((title) => title.id !== id)
    const recommended = others(await getRecommendations(type, id, { language, signal }))
    if (recommended.length > 0) return { kind: 'recommendations', titles: recommended }
    return { kind: 'similar', titles: others(await getSimilar(type, id, { language, signal })) }
  })
  if (!request.data || request.data.titles.length === 0) return null
  return (
    <PosterRow
      id="title-related"
      heading={t(request.data.kind === 'recommendations' ? 'title.recommendations' : 'title.similar')}
      titles={request.data.titles}
    />
  )
}
