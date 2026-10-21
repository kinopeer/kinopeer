import { cx } from '../../lib/cx'
import { Poster } from '../Poster'
import './PosterCard.css'

export interface PosterCardProps {
  title: string
  /** E.g. "Movie · 2024". */
  subtitle?: string
  posterUrl?: string
  className?: string
}

export function PosterCard({ title, subtitle, posterUrl, className }: PosterCardProps) {
  return (
    <article className={cx('ks-pcard', className)}>
      <Poster src={posterUrl} />
      <div className="ks-pcard-text">
        <h3 className="ks-pcard-title ks-clamp2">{title}</h3>
        {subtitle && <p className="t-cap c3 ks-num">{subtitle}</p>}
      </div>
    </article>
  )
}
