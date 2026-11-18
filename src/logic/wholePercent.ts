/**
 * A fraction as the whole percent the app shows: clamped to 0–100 and rounded down, so 99.9%
 * never shows as 100%. `format.percent` writes it out; the "In downloads" marks compare it.
 */
export function wholePercent(fraction: number): number {
  return Math.floor(Math.min(1, Math.max(0, fraction)) * 100)
}
