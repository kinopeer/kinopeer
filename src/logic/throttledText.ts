import type { TFunction } from 'i18next'

/** Says how long to wait before trying the password again: minutes up to an hour, then hours, rounded up. */
export function throttledText(t: TFunction, ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return minutes < 60
    ? t('signIn.throttledMinutes', { count: minutes })
    : t('signIn.throttledHours', { count: Math.ceil(minutes / 60) })
}
