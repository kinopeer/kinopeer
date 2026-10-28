/** The first films are from the 1870s; a few years ahead covers announced titles. */
const FIRST_YEAR = 1870
const YEARS_AHEAD = 10

/** The year to search by: four digits in a plausible range, else none (a year still being typed, say). */
export function parseYear(value: string, now = new Date()): number | undefined {
  if (!/^\d{4}$/.test(value)) return undefined
  const year = Number(value)
  return year >= FIRST_YEAR && year <= now.getFullYear() + YEARS_AHEAD ? year : undefined
}

/** Four digits that still aren't a year to search by, such as 1850: the field says so, as the search ignores it. */
export function isYearOutOfRange(value: string, now = new Date()): boolean {
  return /^\d{4}$/.test(value) && parseYear(value, now) === undefined
}
