import { describe, expect, it } from 'vitest'
import { fieldToLimit, limitToField } from './speedLimits'

describe('limitToField and fieldToLimit', () => {
  it('shows a limit in MB/s and no limit as an empty field', () => {
    expect(limitToField(2_500_000)).toBe('2.5')
    expect(limitToField(123_456)).toBe('0.12')
    expect(limitToField(0)).toBe('')
    expect(limitToField(-1)).toBe('')
  })

  it('reads MB/s with a dot or a comma, an empty field as no limit, and rejects the rest', () => {
    expect(fieldToLimit('2.5')).toBe(2_500_000)
    expect(fieldToLimit(' 2,5 ')).toBe(2_500_000)
    expect(fieldToLimit('')).toBe(0)
    expect(fieldToLimit('0')).toBe(0)
    expect(fieldToLimit('-1')).toBeNull()
    expect(fieldToLimit('fast')).toBeNull()
  })
})
