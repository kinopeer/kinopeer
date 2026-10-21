import type { ReleaseInfo } from './parseRelease'

export interface QualityBadge {
  kind: 'res' | 'default' | 'hdr'
  label: string
}

/** Resolution, source, codec and HDR badges for a release, in display order. */
export function qualityBadges(info: ReleaseInfo): QualityBadge[] {
  return [
    info.resolution && { kind: 'res' as const, label: info.resolution },
    info.source && { kind: 'default' as const, label: info.source },
    info.codec && { kind: 'default' as const, label: info.codec },
    ...info.hdr.map((hdr) => ({ kind: 'hdr' as const, label: hdr === 'DV' ? 'Dolby Vision' : hdr })),
  ].filter((badge) => !!badge)
}
