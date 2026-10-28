import { describe, expect, it } from 'vitest'
import { changedLimit, fieldToLimit, limitToField } from './speedLimits'

describe('limitToField and fieldToLimit', () => {
  it('shows a limit in MB/s and no limit as an empty field', () => {
    expect(limitToField(2_500_000)).toBe('2.5')
    expect(limitToField(123_456)).toBe('0.123')
    expect(limitToField(1024)).toBe('0.001')
    expect(limitToField(100)).toBe('0.001')
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
    expect(fieldToLimit('0x10')).toBeNull()
    expect(fieldToLimit('1e3')).toBeNull()
    expect(fieldToLimit('.5')).toBeNull()
  })

  it('rejects a positive limit too small to be one, rather than reading it as no limit', () => {
    expect(fieldToLimit('0.0000001')).toBeNull()
    expect(fieldToLimit('0.001')).toBe(1000)
  })
})

describe('changedLimit', () => {
  it('leaves out a field whose text is as it was, so a KiB-based limit survives', () => {
    expect(changedLimit(limitToField(512_000), '0.512')).toBeUndefined()
    expect(changedLimit('0.512', ' 0.512 ')).toBeUndefined()
    expect(changedLimit('0.512', '1')).toBe(1_000_000)
    expect(changedLimit('0.512', '')).toBe(0)
    expect(changedLimit('', 'x')).toBeNull()
  })
})
