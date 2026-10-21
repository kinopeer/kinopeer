import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ETA_INFINITY, createFormatters } from './format'

const en = () => createFormatters(i18n.t, 'en')
const ru = () => createFormatters(i18n.getFixedT('ru'), 'ru')

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
