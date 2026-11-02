// Trial line, never merged.
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** qBittorrent reports this ETA (100 days) when it can't estimate one. */
export const ETA_INFINITY = 8_640_000

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const NBSP = '\u00a0'

export interface Formatters {
  /** Decimal units, as in the design: 1.2 GB, 845 MB. */
  size: (bytes: number) => string
  /** Bytes per second: 4.3 MB/s. */
  speed: (bytesPerSecond: number) => string
  /** Seconds left: 12 min, 1h 5m, 2d 3h; ∞ when unknown. */
  eta: (seconds: number) => string
  /** A known length in seconds, e.g. a runtime: 48 min, 2h 46m. */
  duration: (seconds: number) => string
  /** Whole percent, rounded down so 99.9% never shows as 100%. */
  percent: (fraction: number) => string
  /** How long ago something updated: just now, 5 min ago, 2 h ago. */
  since: (date: number, now?: number) => string
  /** How long ago, compactly: 3 d, 5 mo, 2 y. */
  age: (date: Date | string, now?: number) => string
}

export function createFormatters(t: TFunction, language: string): Formatters {
  const number = (value: number, digits: number) =>
    value.toLocaleString(language, { minimumFractionDigits: digits, maximumFractionDigits: digits })

  const size = (bytes: number) => {
    let value = Math.max(0, bytes || 0)
    let unit = 0
    while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
      value /= 1000
      unit++
    }
    const digits = unit === 0 || value >= 100 ? 0 : value < 10 && unit >= 3 ? 2 : 1
    return `${number(value, digits)}${NBSP}${t(`format.${SIZE_UNITS[unit]}`)}`
  }

  const duration = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60))
    if (minutes < 60) return t('format.etaMinutes', { minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('format.etaHours', { hours, minutes: minutes % 60 })
    return t('format.etaDays', { days: Math.floor(hours / 24), hours: hours % 24 })
  }

  return {
    size,
    speed: (bytesPerSecond) => t('format.speed', { value: size(bytesPerSecond) }),
    eta: (seconds) =>
      !Number.isFinite(seconds) || seconds <= 0 || seconds >= ETA_INFINITY ? t('format.etaUnknown') : duration(seconds),
    duration,
    percent: (fraction) =>
      `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100).toLocaleString(language)}%`,
    since: (date, now = Date.now()) => {
      const minutes = Math.floor(Math.max(0, now - date) / 60_000)
      if (minutes < 1) return t('format.justNow')
      if (minutes < 60) return t('format.minutesAgo', { count: minutes })
      return t('format.hoursAgo', { count: Math.floor(minutes / 60) })
    },
    age: (date, now = Date.now()) => {
      const days = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86_400_000))
      if (days < 30) return t('format.ageDays', { count: days })
      if (days < 365) return t('format.ageMonths', { count: Math.round(days / 30) })
      return t('format.ageYears', { count: Math.round(days / 365) })
    },
  }
}

export function useFormatters(): Formatters {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  return useMemo(() => createFormatters(t, language), [t, language])
}
