import { Link } from 'react-router'
import { cx } from '../../lib/cx'
import { Poster } from '../Poster'
import './PosterCard.css'

export interface PosterCardProps {
  title: string
  /** E.g. "Movie · 2024". */
  subtitle?: string
  posterUrl?: string
  /** Makes the whole card a link. */
  to?: string
  className?: string
}

export function PosterCard({ title, subtitle, posterUrl, to, className }: PosterCardProps) {
  const content = (
    <>
      <Poster src={posterUrl} />
      <div className="ks-pcard-text">
        <h3 className="ks-pcard-title ks-clamp2">{title}</h3>
        {subtitle && <p className="t-cap c3 ks-num">{subtitle}</p>}
      </div>
    </>
  )
  return to ? (
    <Link to={to} className={cx('ks-pcard', className)}>
      {content}
    </Link>
  ) : (
    <article className={cx('ks-pcard', className)}>{content}</article>
  )
}
