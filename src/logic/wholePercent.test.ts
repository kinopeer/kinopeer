import { describe, expect, it } from 'vitest'
import { wholePercent } from './wholePercent'

describe('wholePercent', () => {
  it('rounds down, so a torrent short of done never shows 100', () => {
    expect([wholePercent(0), wholePercent(0.625), wholePercent(0.999), wholePercent(1)]).toEqual([0, 62, 99, 100])
  })

  it('keeps to 0–100', () => {
    expect([wholePercent(-0.1), wholePercent(1.2)]).toEqual([0, 100])
  })
})
