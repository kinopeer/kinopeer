import { describe, expect, it } from 'vitest'
import { retryAfterSeconds } from './retryAfter'

describe('retryAfterSeconds', () => {
  it.each([
    ['ten seconds', '10', 10],
    ['ten minutes, the most', '600', 600],
    ['a day, as ten minutes', '86400', 600],
    ['a number past any timer, as ten minutes', '99999999999999999999', 600],
  ])('takes %s', (_, value, seconds) => {
    expect(retryAfterSeconds(value)).toBe(seconds)
  })

  it.each([
    ['none', null],
    ['zero', '0'],
    ['a fraction', '1.5'],
    ['Infinity', 'Infinity'],
    ['a number in another notation', '1e5'],
    ['a negative number', '-30'],
    ['the date form', 'Wed, 25 Nov 2026 10:00:00 GMT'],
  ])('takes %s as no wait, leaving the caller’s own', (_, value) => {
    expect(retryAfterSeconds(value)).toBeUndefined()
  })
})
