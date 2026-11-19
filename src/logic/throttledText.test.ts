import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { throttledText } from './throttledText'

describe('throttledText', () => {
  it('says the wait in whole minutes up to an hour, then in whole hours, rounded up', () => {
    const t = i18n.t.bind(i18n)
    expect(throttledText(t, 0)).toBe('Too many wrong passwords. Try again in 1 minute.')
    expect(throttledText(t, 60_001)).toBe('Too many wrong passwords. Try again in 2 minutes.')
    expect(throttledText(t, 59 * 60_000)).toBe('Too many wrong passwords. Try again in 59 minutes.')
    expect(throttledText(t, 59 * 60_000 + 1)).toBe('Too many wrong passwords. Try again in 1 hour.')
    expect(throttledText(t, 16 * 60 * 60_000)).toBe('Too many wrong passwords. Try again in 16 hours.')
  })

  it('says it in Russian with the right forms', async () => {
    await i18n.changeLanguage('ru')
    const t = i18n.t.bind(i18n)
    expect(throttledText(t, 15 * 60_000)).toBe('Слишком много неверных паролей. Попробуйте через 15 минут.')
    expect(throttledText(t, 21 * 60_000)).toBe('Слишком много неверных паролей. Попробуйте через 21 минуту.')
    expect(throttledText(t, 2 * 60 * 60_000)).toBe('Слишком много неверных паролей. Попробуйте через 2 часа.')
  })
})
