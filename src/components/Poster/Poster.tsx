import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Poster.css'

/** What an empty poster does when pressed: its label, under its icon, names the button. */
export interface PosterAction {
  label: string
  icon: IconName
  onClick: () => void
  disabled?: boolean
}

export interface PosterProps {
  /** Image URL; a striped placeholder with a film icon when missing. */
  src?: string
  className?: string
  style?: CSSProperties
  /** Overlays such as the queue position. */
  children?: ReactNode
  /**
   * Without `src`, the placeholder is a button that does this, in the same frame, so nothing moves
   * when it turns into one or back.
   */
  action?: PosterAction
}

/** 2:3 poster frame. Decorative unless it's an empty one with an action: the title next to it carries the name. */
export function Poster({ src, className, style, children, action }: PosterProps) {
  if (action && !src) {
    return (
      <button
        type="button"
        className={cx('ks-poster ks-poster-action', className)}
        style={style}
        disabled={action.disabled}
        onClick={action.onClick}
      >
        <span className="ks-poster-art ks-poster-none">
          <Icon name={action.icon} size={22} />
          <span className="ks-poster-label">{action.label}</span>
        </span>
        {children}
      </button>
    )
  }
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
