import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../lib/cx'
import { Poster } from '../Poster'
import './PosterCard.css'

export interface PosterCardProps {
  title: string
  /** E.g. "Movie · 2024". */
  subtitle?: string
  posterUrl?: string
  /** Makes the poster and text a link. */
  to?: string
  /** Shown over the poster, such as status and progress. */
  overlay?: ReactNode
  /** A button next to the title, outside the link (a button can't sit inside a link). */
  action?: ReactNode
  className?: string
}

export function PosterCard({ title, subtitle, posterUrl, to, overlay, action, className }: PosterCardProps) {
  const content = (
    <>
      <Poster src={posterUrl}>{overlay}</Poster>
      <div className="ks-pcard-text">
        <h3 className="ks-pcard-title ks-clamp2">{title}</h3>
        {subtitle && <p className="ks-pcard-sub t-cap c3 ks-num ks-trunc">{subtitle}</p>}
      </div>
    </>
  )
  return (
    <article className={cx('ks-pcard', action != null && 'has-action', className)}>
      {to ? (
        <Link to={to} className="ks-pcard-main">
          {content}
        </Link>
      ) : (
        <div className="ks-pcard-main">{content}</div>
      )}
      {action != null && <div className="ks-pcard-action">{action}</div>}
    </article>
  )
}

/** A placeholder card while results load. */
export function PosterCardSkeleton() {
  return (
    <div className="ks-pcard" aria-hidden="true">
      <div className="ks-skel ks-pcard-skel-poster" />
      <div className="ks-pcard-text">
        <div className="ks-skel" style={{ height: 13, width: '80%', margin: '3px 0' }} />
        <div className="ks-skel" style={{ height: 10, width: '50%', marginTop: 6 }} />
      </div>
    </div>
  )
}
