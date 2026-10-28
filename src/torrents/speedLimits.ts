/** Limits are entered in MB/s, the unit `format.speed` shows (decimal, like the rest of the app). */
const MB = 1_000_000

/** qBittorrent keeps a limit in an int: a larger one wraps around, or reads as no limit. */
export const MAX_LIMIT = 2_147_483_647

/** A limit in bytes/s as the field's text, with the language's decimal separator: empty when there
 *  is none. Three decimals keep qBittorrent's smallest limit, 1 KiB/s, from showing as 0. */
export function limitToField(bytes: number, language: string): string {
  if (bytes <= 0) return ''
  const value = Math.max(0.001, Math.round((bytes / MB) * 1000) / 1000)
  return value.toLocaleString(language, { maximumFractionDigits: 3, useGrouping: false })
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
 *  units the field rounds (qBittorrent's own UI uses KiB/s) stays exactly as it was. */
export function changedLimit(initial: string, text: string): number | null | undefined {
  return text.trim() === initial ? undefined : fieldToLimit(text)
}
