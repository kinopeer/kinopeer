/** Limits are entered in MB/s, the unit `format.speed` shows (decimal, like the rest of the app). */
const MB = 1_000_000

/** qBittorrent keeps a limit in an int: a larger one wraps around, or reads as no limit. */
const MAX_LIMIT = 2_147_483_647

/** A limit in bytes/s as the field's text, with the language's decimal separator: empty when there
 *  is none. Three decimals keep qBittorrent's smallest limit, 1 KiB/s, from showing as 0. */
export function limitToField(bytes: number | undefined, language: string): string {
  // Also when qBittorrent doesn't report it, so the field doesn't show NaN.
  if (!(bytes !== undefined && bytes > 0)) return ''
  // Rounded down at the top, so the largest limit fills as one `fieldToLimit` takes back.
  const value = Math.min(Math.max(0.001, Math.round((bytes / MB) * 1000) / 1000), Math.floor(MAX_LIMIT / 1000) / 1000)
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
  return (value > 0 && bytes < 1000) || bytes > MAX_LIMIT ? null : bytes
}

/** The limit to send for a field: undefined when its text is as it was, so a limit set elsewhere in
 *  units the field rounds (qBittorrent's own UI uses KiB/s) stays exactly as it was. `resend` is for a
 *  field a failed save sent, which qBittorrent may have taken: it goes out whatever its text. */
export function changedLimit(initial: string, text: string, resend = false): number | null | undefined {
  return !resend && text.trim() === initial ? undefined : fieldToLimit(text)
}
