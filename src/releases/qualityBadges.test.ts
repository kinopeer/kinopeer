import { describe, expect, it } from 'vitest'
import { parseRelease } from './parseRelease'
import { qualityBadges } from './qualityBadges'

describe('qualityBadges', () => {
  it('lists the resolution, source, codec and HDR formats in that order', () => {
    expect(qualityBadges(parseRelease('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR10.HEVC-FGT'))).toEqual([
      { kind: 'res', label: '2160p' },
      { kind: 'default', label: 'REMUX' },
      { kind: 'default', label: 'HEVC' },
      { kind: 'hdr', label: 'HDR' },
    ])
  })

  it('spells Dolby Vision out and leaves out what the name doesn’t say', () => {
    expect(qualityBadges(parseRelease('Shogun.S01.2160p.WEB-DL.DV.HDR.H.265'))).toEqual([
      { kind: 'res', label: '2160p' },
      { kind: 'default', label: 'WEB-DL' },
      { kind: 'default', label: 'HEVC' },
      { kind: 'hdr', label: 'Dolby Vision' },
      { kind: 'hdr', label: 'HDR' },
    ])
    expect(qualityBadges(parseRelease('Some Home Video'))).toEqual([])
  })
})
