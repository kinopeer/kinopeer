import { describe, expect, it } from 'vitest'
import { formatList } from './formatList'

describe('formatList', () => {
  it('joins items in the interface language', () => {
    expect(formatList(['2160p', 'Дубляж', '100+ сидов'], { language: 'ru' })).toBe('2160p, Дубляж и 100+ сидов')
    expect(formatList(['2160p', 'Dubbed', '100+ seeds'], { language: 'en' })).toBe('2160p, Dubbed, and 100+ seeds')
  })

  it('leaves out the conjunction in the narrow style', () => {
    expect(formatList(['Kinozal', 'RuTracker'], { language: 'ru' }, 'narrow')).toBe('Kinozal, RuTracker')
  })
})
