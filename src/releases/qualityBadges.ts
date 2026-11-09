import type { ReleaseInfo, Source } from './parseRelease'

export interface QualityBadge {
  kind: 'res' | 'default' | 'hdr'
  label: string
}

/**
 * What a source is called: as indexers write it, but a theater rip by the interface's own word,
 * since no one term covers CAM, TS and TC in both languages.
 */
export const sourceName =
  (t: (key: 'releases.theaterRip') => string) =>
  (source: Source): string =>
    source === 'CAM' ? t('releases.theaterRip') : source

/** Resolution, source, codec and HDR badges for a release, in display order; `name` names the source. */
export function qualityBadges(info: ReleaseInfo, name: (source: Source) => string): QualityBadge[] {
  return [
    info.resolution && { kind: 'res' as const, label: info.resolution },
    info.source && { kind: 'default' as const, label: name(info.source) },
    info.codec && { kind: 'default' as const, label: info.codec },
    ...info.hdr.map((hdr) => ({ kind: 'hdr' as const, label: hdr === 'DV' ? 'Dolby Vision' : hdr })),
  ].filter((badge) => !!badge)
}
