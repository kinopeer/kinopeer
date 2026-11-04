import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ETA_INFINITY, createFormatters } from './format'

const en = () => createFormatters(i18n.t, 'en')
const ru = () => createFormatters(i18n.getFixedT('ru'), 'ru')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('size', () => {
  it('uses decimal units with sensible precision', () => {
    const { size } = en()
    expect(size(0)).toBe('0\u00a0B')
    expect(size(512)).toBe('512\u00a0B')
    expect(size(1_500)).toBe('1.5\u00a0KB')
    expect(size(845_000_000)).toBe('845\u00a0MB')
    expect(size(4_380_000_000)).toBe('4.38\u00a0GB')
    expect(size(21_400_000_000)).toBe('21.4\u00a0GB')
  })

  it('localizes the decimal separator and units', () => {
    expect(ru().size(1_210_000_000_000)).toBe('1,21\u00a0ТБ')
  })

  it('builds a number format once per language and digits, not on every call', () => {
    const built = vi.spyOn(Intl, 'NumberFormat')
    // A language no other test uses, so nothing is cached yet.
    const { size, percent } = createFormatters(i18n.t, 'de')
    expect([size(1_500), size(2_500), size(4_380_000_000), size(845_000_000), percent(0.5)]).toEqual([
      '1,5\u00a0KB',
      '2,5\u00a0KB',
      '4,38\u00a0GB',
      '845\u00a0MB',
      '50%',
    ])
    // One, two and no digits after the point.
    expect(built).toHaveBeenCalledTimes(3)
    expect(createFormatters(i18n.t, 'de').size(3_500)).toBe('3,5\u00a0KB')
    expect(built).toHaveBeenCalledTimes(3)
  })
})

describe('speed', () => {
  it('appends per second', () => {
    expect(en().speed(4_300_000)).toBe('4.3\u00a0MB/s')
    expect(ru().speed(4_300_000)).toBe('4,3\u00a0МБ/с')
  })
})

describe('eta', () => {
  it('rounds to minutes, hours and days', () => {
    const { eta } = en()
    expect(eta(20)).toBe('1 min')
    expect(eta(12 * 60)).toBe('12 min')
    expect(eta(65 * 60)).toBe('1h 5m')
    expect(eta(51 * 3600)).toBe('2d 3h')
    expect(ru().eta(65 * 60)).toBe('1 ч 5 мин')
  })

  it('shows infinity when qBittorrent has no estimate', () => {
    expect(en().eta(ETA_INFINITY)).toBe('∞')
    expect(en().eta(0)).toBe('∞')
  })
})

describe('duration', () => {
  it('formats a runtime', () => {
    expect(en().duration(166 * 60)).toBe('2h 46m')
    expect(ru().duration(48 * 60)).toBe('48 мин')
  })
})

describe('percent', () => {
  it('rounds down and clamps', () => {
    const { percent } = en()
    expect(percent(0.999)).toBe('99%')
    expect(percent(1)).toBe('100%')
    expect(percent(-1)).toBe('0%')
  })
})

describe('age', () => {
  const now = Date.parse('2026-10-21T12:00:00Z')
  const daysAgo = (days: number) => new Date(now - days * 86_400_000)

  it('counts days, months and years', () => {
    expect(en().age(daysAgo(3), now)).toBe('3 d')
    expect(en().age(daysAgo(160), now)).toBe('5 mo')
    expect(en().age(daysAgo(800), now)).toBe('2 y')
    expect(en().age(daysAgo(-1), now)).toBe('0 d')
  })

  it('uses Russian plurals for years', () => {
    expect(ru().age(daysAgo(3), now)).toBe('3 дн.')
    expect(ru().age(daysAgo(365), now)).toBe('1 год')
    expect(ru().age(daysAgo(800), now)).toBe('2 года')
    expect(ru().age(daysAgo(5 * 365), now)).toBe('5 лет')
  })
})

describe('time', () => {
  it('gives the time of day to the second in the language’s style', () => {
    const date = new Date(2026, 10, 3, 21, 5, 7).getTime()
    // The space before PM differs between ICU versions.
    expect(en().time(date)).toMatch(/^9:05:07\sPM$/)
    expect(ru().time(date)).toBe('21:05:07')
  })
})

describe('since', () => {
  it('says how long ago something updated', () => {
    const now = 1_760_000_000_000
    expect(en().since(now - 20_000, now)).toBe('just now')
    expect(en().since(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(en().since(now - 125 * 60_000, now)).toBe('2 h ago')
    expect(ru().since(now - 3 * 60_000, now)).toBe('3 мин назад')
  })
})
