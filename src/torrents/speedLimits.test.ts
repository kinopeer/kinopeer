import { describe, expect, it } from 'vitest'
import { changedLimit, fieldToLimit, isUnfinished, limitToField } from './speedLimits'

describe('limitToField and fieldToLimit', () => {
  it('shows a limit in MB/s and no limit as an empty field', () => {
    expect(limitToField(2_500_000, 'en')).toBe('2.5')
    expect(limitToField(123_456, 'en')).toBe('0.123')
    expect(limitToField(1024, 'en')).toBe('0.001')
    expect(limitToField(100, 'en')).toBe('0.001')
    expect(limitToField(0, 'en')).toBe('')
    expect(limitToField(-1, 'en')).toBe('')
    // A qBittorrent that doesn't report it: no limit known, rather than "NaN".
    expect(limitToField(undefined, 'en')).toBe('')
  })

  it("writes the language's decimal separator and no grouping", () => {
    expect(limitToField(2_500_000, 'ru')).toBe('2,5')
    expect(limitToField(1_500_000_000, 'en')).toBe('1500')
    expect(limitToField(1_500_000_000, 'ru')).toBe('1500')
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
    expect(fieldToLimit('.')).toBeNull()
    expect(fieldToLimit('1.2.3')).toBeNull()
  })

  it('takes a decimal with nothing on one side of the separator, as while typing one', () => {
    expect(fieldToLimit('2,')).toBe(2_000_000)
    expect(fieldToLimit('5.')).toBe(5_000_000)
    expect(fieldToLimit('.5')).toBe(500_000)
    expect(fieldToLimit(',5')).toBe(500_000)
  })

  it('tells a lone separator, the start of a decimal like ,5, from a wrong value', () => {
    expect(isUnfinished('.')).toBe(true)
    expect(isUnfinished(' , ')).toBe(true)
    expect(isUnfinished('')).toBe(false)
    expect(isUnfinished('abc')).toBe(false)
    expect(isUnfinished('1.2.3')).toBe(false)
  })

  it('rejects a positive limit too small to be one, rather than reading it as no limit', () => {
    expect(fieldToLimit('0.0000001')).toBeNull()
    expect(fieldToLimit('0.001')).toBe(1000)
  })

  it("rejects a limit above what qBittorrent stores, which it would wrap or read as no limit", () => {
    expect(fieldToLimit('2147')).toBe(2_147_000_000)
    expect(fieldToLimit('2147.4')).toBeNull()
    expect(fieldToLimit('2148')).toBeNull()
    expect(fieldToLimit('3000')).toBeNull()
    expect(fieldToLimit('9'.repeat(40))).toBeNull()
  })

  it('fills a limit above the field\'s maximum as the maximum, which the field takes back', () => {
    expect(limitToField(2_147_483_647, 'en')).toBe('2147')
    expect(limitToField(2_147_000_600, 'en')).toBe('2147')
    expect(fieldToLimit(limitToField(2_147_483_647, 'en'))).toBe(2_147_000_000)
  })
})

describe('changedLimit', () => {
  it('leaves out a field whose text is as it was, so a KiB-based limit survives', () => {
    expect(changedLimit(limitToField(512_000, 'en'), '0.512')).toBeUndefined()
    expect(changedLimit('0.512', ' 0.512 ')).toBeUndefined()
    expect(changedLimit('0.512', '1')).toBe(1_000_000)
    expect(changedLimit('0.512', '')).toBe(0)
    expect(changedLimit('', 'x')).toBeNull()
  })

  it('sends a field that went out in a failed save even when its text is back as it was', () => {
    expect(changedLimit('1', '1', true)).toBe(1_000_000)
    expect(changedLimit('', '', true)).toBe(0)
    expect(changedLimit('', 'x', true)).toBeNull()
  })
})
