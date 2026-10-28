import { describe, expect, it } from 'vitest'
import { isYearOutOfRange, parseYear } from './year'

describe('parseYear', () => {
  const now = new Date(2026, 9, 28)

  it('takes four digits in a plausible range', () => {
    expect(parseYear('1999', now)).toBe(1999)
    expect(parseYear('1870', now)).toBe(1870)
    expect(parseYear('2036', now)).toBe(2036)
  })

  it('ignores a year still being typed or out of range', () => {
    for (const value of ['', '2', '202', '1869', '2037', '0000']) expect(parseYear(value, now)).toBeUndefined()
  })
})

describe('isYearOutOfRange', () => {
  const now = new Date(2026, 9, 28)

  it('flags four digits that are no year to search by', () => {
    expect(isYearOutOfRange('1850', now)).toBe(true)
    expect(isYearOutOfRange('2099', now)).toBe(true)
  })

  it('leaves a year in range, and one still being typed, alone', () => {
    for (const value of ['', '20', '1999', '2036']) expect(isYearOutOfRange(value, now)).toBe(false)
  })
})
