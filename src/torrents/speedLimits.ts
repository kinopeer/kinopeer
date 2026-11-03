import type { TFunction } from 'i18next'
import type { Formatters } from '../lib/format'

/** Limits are entered in MB/s, the unit `format.speed` shows (decimal, like the rest of the app). */
const MB = 1_000_000

/** The field's bounds in MB/s. qBittorrent keeps a limit in an int (2 147 483 647 B/s): a larger one
 *  wraps around, or reads as no limit, so the field stops at the last whole MB/s under it. */
export const MIN_MB = 0.001
export const MAX_MB = 2147

/** A limit in bytes/s as the field's text, with the language's decimal separator: empty when there
 *  is none. Three decimals keep qBittorrent's smallest limit, 1 KiB/s, from showing as 0. */
export function limitToField(bytes: number | undefined, language: string): string {
  // Also when qBittorrent doesn't report it or sends something else, so the field doesn't show NaN.
  if (bytes === undefined || !(bytes > 0)) return ''
  // Kept within the field's bounds, so what it fills is what it takes back. A limit above the
  // maximum, set elsewhere, stays as it is while its field is untouched.
  const value = Math.min(Math.max(MIN_MB, Math.round((bytes / MB) * 1000) / 1000), MAX_MB)
  return value.toLocaleString(language, { maximumFractionDigits: 3, useGrouping: false })
}

/** A lone decimal separator: the start of a decimal like `,5`, not a number yet but no mistake either. */
export function isUnfinished(text: string): boolean {
  return /^[.,]$/.test(text.trim())
}

/** The field's text as bytes/s: 0 for an empty field or 0, null when it isn't a decimal number or
 *  is out of qBittorrent's range. Either side of the separator may be empty (`5.`, `,5`), as while
 *  typing a decimal. */
export function fieldToLimit(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return null
  const value = Number(trimmed.replace(',', '.'))
  const bytes = Math.round(value * MB)
  return (value > 0 && bytes < MIN_MB * MB) || bytes > MAX_MB * MB ? null : bytes
}

/** The limit to send for a field: undefined when its text is as it was, so a limit set elsewhere in
 *  units the field rounds (qBittorrent's own UI uses KiB/s) stays exactly as it was. `resend` is for a
 *  field a failed save sent, which qBittorrent may have taken: it goes out whatever its text. */
export function changedLimit(initial: string, text: string, resend = false): number | null | undefined {
  return !resend && text.trim() === initial ? undefined : fieldToLimit(text)
}

/** A torrent's own speed limits in bytes/s, each only when it's set, and at least one of them. */
export type OwnLimits = { download: number; upload?: number } | { download?: undefined; upload: number }

/** The limits set on the torrent itself, null when neither is: qBittorrent reports no limit as 0 or
 *  -1. The alternative and global limits aren't the torrent's and aren't here. */
export function ownLimits(torrent: { dl_limit: number; up_limit: number }): OwnLimits | null {
  // Also when qBittorrent doesn't report one, as for limitToField.
  const upload = torrent.up_limit > 0 ? torrent.up_limit : undefined
  if (torrent.dl_limit > 0) return { download: torrent.dl_limit, upload }
  return upload === undefined ? null : { upload }
}

/**
 * The limits in words: "Download up to 25 MB/s, upload up to 1 MB/s" (`value`, the More menu's
 * hint), or the same named as speed limits (`mark`, the mark's accessible name).
 */
export function describeLimits(limits: OwnLimits, kind: 'mark' | 'value', t: TFunction, format: Formatters): string {
  if (limits.download === undefined) {
    const speed = format.speed(limits.upload)
    return kind === 'mark' ? t('limits.markUpload', { speed }) : t('limits.valueUpload', { speed })
  }
  if (limits.upload === undefined) {
    const speed = format.speed(limits.download)
    return kind === 'mark' ? t('limits.markDownload', { speed }) : t('limits.valueDownload', { speed })
  }
  const values = { download: format.speed(limits.download), upload: format.speed(limits.upload) }
  return kind === 'mark' ? t('limits.markBoth', values) : t('limits.valueBoth', values)
}
