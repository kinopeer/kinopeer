import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../Icon'
import './Poster.css'

export interface PosterProps {
  /** Image URL; a striped placeholder with a film icon when missing. */
  src?: string
  className?: string
  style?: CSSProperties
  /** Overlays such as the queue position. */
  children?: ReactNode
}

/** 2:3 poster frame. Decorative: the title next to it carries the name. */
export function Poster({ src, className, style, children }: PosterProps) {
  return (
    <div className={cx('ks-poster', className)} style={style}>
      {src ? (
        <img className="ks-poster-art" src={src} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="ks-poster-art ks-poster-none">
          <Icon name="film" size={22} />
        </div>
      )}
      {children}
    </div>
  )
}
