/** Limits are entered in MB/s, the unit `format.speed` shows (decimal, like the rest of the app). */
const MB = 1_000_000

/** A limit in bytes/s as the field's text: empty when there is none. Three decimals keep qBittorrent's
 *  smallest limit, 1 KiB/s, from showing as 0. */
export function limitToField(bytes: number): string {
  return bytes > 0 ? String(Math.max(0.001, Math.round((bytes / MB) * 1000) / 1000)) : ''
}

/** The field's text as bytes/s: 0 for an empty field or 0, null when it isn't a plain decimal number
 *  or is too small to be a limit. */
export function fieldToLimit(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed.replace(',', '.'))
  const bytes = Math.round(value * MB)
  return value > 0 && bytes < 1000 ? null : bytes
}

/** The limit to send for a field: undefined when its text is as it was, so a limit set elsewhere in
 *  units the field rounds (qBittorrent's own UI uses KiB/s) stays exactly as it was. */
export function changedLimit(initial: string, text: string): number | null | undefined {
  return text.trim() === initial ? undefined : fieldToLimit(text)
}
