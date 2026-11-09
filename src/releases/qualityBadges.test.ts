import { describe, expect, it } from 'vitest'
import { parseRelease } from './parseRelease'
import { qualityBadges, sourceName } from './qualityBadges'

describe('qualityBadges', () => {
  it('lists the resolution, source, codec and HDR formats in that order', () => {
    expect(qualityBadges(parseRelease('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR10.HEVC-GRPA'), String)).toEqual([
      { kind: 'res', label: '2160p' },
      { kind: 'default', label: 'REMUX' },
      { kind: 'default', label: 'HEVC' },
      { kind: 'hdr', label: 'HDR' },
    ])
  })

  it('spells Dolby Vision out and leaves out what the name doesn’t say', () => {
    expect(qualityBadges(parseRelease('Shogun.S01.2160p.WEB-DL.DV.HDR.H.265'), String)).toEqual([
      { kind: 'res', label: '2160p' },
      { kind: 'default', label: 'WEB-DL' },
      { kind: 'default', label: 'HEVC' },
      { kind: 'hdr', label: 'Dolby Vision' },
      { kind: 'hdr', label: 'HDR' },
    ])
    expect(qualityBadges(parseRelease('Some Home Video'), String)).toEqual([])
  })

  it('names a theater rip in the language given', () => {
    expect(qualityBadges(parseRelease('Dune.Part.Two.2024.HDTS.x264'), () => 'Экранка')).toEqual([
      { kind: 'default', label: 'Экранка' },
      { kind: 'default', label: 'AVC' },
    ])
  })
})

describe('sourceName', () => {
  it('names a theater rip by its translation and every other source as written', () => {
    const name = sourceName((key) => `t:${key}`)
    expect(name('CAM')).toBe('t:releases.theaterRip')
    expect(name('WEB-DL')).toBe('WEB-DL')
  })
})
