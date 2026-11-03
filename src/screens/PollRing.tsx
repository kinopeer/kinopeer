import { useSyncExternalStore, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { POLL_INTERVAL_MS, type PollSource } from '../torrents/useMainData'
import './PollRing.css'

type PollRingState = 'filling' | 'waiting' | 'offline'

export interface PollRingProps {
  poll: PollSource
  /** Said before the update time in the tooltip, where nothing beside the ring says it (the rail's qBittorrent version). */
  context?: string
  className?: string
}

/**
 * The qBittorrent poll at a glance: a ring that fills until the next poll, stays full and pulses while
 * the answer is awaited, and turns to the error color while qBittorrent doesn't answer. It reads the
 * poll on its own, so it renders when a request goes out or an answer arrives and the screen it's on
 * doesn't; the filling is a CSS animation that starts over with each answer. Its name and tooltip
 * say when the data was last updated.
 */
export function PollRing({ poll, context, className }: PollRingProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const { inFlight, offline, updatedAt } = useSyncExternalStore(poll.subscribe, poll.getPollState)
  const state: PollRingState = offline ? 'offline' : inFlight || updatedAt === null ? 'waiting' : 'filling'
  const time = updatedAt === null ? null : format.time(updatedAt)
  const label = offline
    ? time === null
      ? t('poll.offline')
      : t('poll.offlineSince', { time })
    : time === null
      ? t('poll.waiting')
      : t('poll.updated', { time })
  // The interval counts from the answer, so filling from it shows the wait, not an exact clock.
  const style = { '--poll-interval': `${POLL_INTERVAL_MS}ms` } as CSSProperties
  return (
    <span
      className={cx('poll-ring', `is-${state}`, className)}
      role="img"
      aria-label={label}
      title={context === undefined ? label : t('poll.withContext', { prefix: context, label })}
      style={style}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle className="poll-ring-track" cx="8" cy="8" r="6" pathLength={100} />
        {/* A new element per answer, so its animation starts over. */}
        <circle key={updatedAt ?? 0} className="poll-ring-fill" cx="8" cy="8" r="6" pathLength={100} />
      </svg>
    </span>
  )
}
