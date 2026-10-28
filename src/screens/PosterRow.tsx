import { useTranslation } from 'react-i18next'
import { posterUrl, type Title } from '../api/tmdb'
import { PosterCard } from '../components/PosterCard'
import './PosterRow.css'
import { titleSubtitle } from './titleSubtitle'

export interface PosterRowProps {
  /** Ties the heading to the section, so the row is a region named by it. Unique on the page. */
  id: string
  heading: string
  titles: Title[]
}

/** A heading over a row of poster cards that scrolls sideways, each card a link to its title. */
export function PosterRow({ id, heading, titles }: PosterRowProps) {
  const { t } = useTranslation()
  return (
    <section className="poster-row" aria-labelledby={id}>
      <h2 id={id} className="t-h3 poster-row-title">
        {heading}
      </h2>
      <ul className="poster-row-list ks-hscroll">
        {titles.map((title) => (
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
    </section>
  )
}
