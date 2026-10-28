/** Limits are entered in MB/s, the unit `format.speed` shows (decimal, like the rest of the app). */
const MB = 1_000_000

/** A limit in bytes/s as the field's text: empty when there is none. */
export function limitToField(bytes: number): string {
  return bytes > 0 ? String(Math.round((bytes / MB) * 100) / 100) : ''
}

/** The field's text as bytes/s: 0 for an empty field, null when it isn't a number ≥ 0. */
export function fieldToLimit(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return 0
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 ? Math.round(value * MB) : null
}
