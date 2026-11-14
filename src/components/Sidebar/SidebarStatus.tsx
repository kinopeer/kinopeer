import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../../api/qbittorrent'
import { Button } from '../Button'
import { useFormatters } from '../../lib/format'
import { unreachableText } from '../../lib/unreachable'
import { Icon } from '../Icon'
import { IconButton } from '../IconButton'

export interface SidebarStatusProps {
  /** qBittorrent's version, e.g. "5.0.1". */
  version: string
  /** qBittorrent stopped answering. */
  offline: boolean
  /** Who stopped answering: Kinopeer's server or qBittorrent (the default). */
  unreachable?: Unreachable
  /** Speeds in bytes/s and free space in bytes; undefined until known, shown as `—` meanwhile. */
  downloadSpeed?: number
  uploadSpeed?: number
  freeSpace?: number
  /** Whether qBittorrent's alternative speed limits apply; the switch is disabled until it's known. */
  altSpeedLimits?: boolean
  altSpeedDisabled?: boolean
  onToggleAltSpeed?: () => void
  /**
   * Before the connection in the card and at the top of the rail: the poll's ring, which shows
   * whether qBittorrent answers. The rail's gets the connection's status, which nothing beside it
   * shows, for its tooltip.
   */
  indicator?: (status?: string) => ReactNode
}

/** Splits a formatted size or speed into its number and unit, which the rail stacks. */
function splitUnit(text: string): [string, string] {
  const space = text.lastIndexOf('\u00a0')
  return space < 0 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)]
}

/**
 * qBittorrent's status at the bottom of the sidebar: connection, total speeds, free space and the
 * alternative speed limits switch. A card with the labels; in the rail, a narrow column with each
 * number over its unit and the switch as an icon. Each is there from the first paint, `—` and a
 * disabled switch until the poll says them, so the card doesn't grow up from the sidebar's foot as
 * the first one lands (#404).
 */
export function SidebarStatus({
  version,
  offline,
  unreachable,
  downloadSpeed,
  uploadSpeed,
  freeSpace,
  altSpeedLimits,
  altSpeedDisabled,
  onToggleAltSpeed,
  indicator,
}: SidebarStatusProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const speed = (value: number | undefined) => (value === undefined || offline ? '—' : format.speed(value))
  const space = freeSpace === undefined ? '—' : format.size(freeSpace)
  const status = offline ? t('noAnswer.qbittorrent', { context: unreachableText(unreachable) }) : t('sidebar.connected', { version })
  const stacked = (label: string, text: string, icon: ReactNode) => {
    const [value, unit] = splitUnit(text)
    return (
      <p className="ks-side-mini-stat">
        <span className="ks-side-mini-value">
          {icon}
          <span className="sr-only">{label}</span> {value}
        </span>
        {/* A placeholder has no unit: its line is kept, so the column is as tall as once it has one. */}
        <span className="ks-side-mini-unit">{unit || '\u00a0'}</span>
      </p>
    )
  }
  const altSpeedOff = altSpeedDisabled || altSpeedLimits === undefined
  return (
    <section className="ks-side-status" aria-label={t('common.qbittorrent')}>
      <div className="ks-side-card">
        <p className="ks-side-status-head t-cap">
          {indicator?.()}
          <span className="ks-trunc">{status}</span>
        </p>
        <p className="ks-side-status-speeds t-cap ks-num c2">
          <span>
            ↓<span className="sr-only">{t('common.downloadSpeed')}</span> {speed(downloadSpeed)}
          </span>
          <span>
            ↑<span className="sr-only">{t('common.uploadSpeed')}</span> {speed(uploadSpeed)}
          </span>
        </p>
        <p className="t-cap ks-num c3">{t('common.freeSpace', { size: space })}</p>
        <Button
          variant={altSpeedLimits ? 'tonal' : 'secondary'}
          size="sm"
          icon="turtle"
          block
          title={t('speedLimits.alt')}
          aria-pressed={altSpeedLimits ?? false}
          disabled={altSpeedOff}
          onClick={onToggleAltSpeed}
        >
          {t('speedLimits.short')}
        </Button>
      </div>
      <div className="ks-side-mini ks-num">
        <span className="ks-side-mini-indicator">
          {indicator?.(status)}
          <span className="sr-only">{status}</span>
        </span>
        {stacked(t('common.downloadSpeed'), speed(downloadSpeed), <span aria-hidden="true">↓</span>)}
        {stacked(t('common.uploadSpeed'), speed(uploadSpeed), <span aria-hidden="true">↑</span>)}
        {stacked(t('sidebar.freeSpace'), space, <Icon name="disk" size={13} />)}
        <IconButton
          icon="turtle"
          label={t('speedLimits.alt')}
          active={altSpeedLimits ?? false}
          disabled={altSpeedOff}
          onClick={onToggleAltSpeed}
        />
      </div>
    </section>
  )
}
