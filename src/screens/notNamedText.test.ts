import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import type { NotNamedReason } from '../torrents/mediaNames'
import { notNamedText } from './notNamedText'

const t = ((key: string) => key) as unknown as TFunction

describe('notNamedText', () => {
  it('says each reason with its own text', () => {
    const reasons: Record<NotNamedReason, string> = {
      'no-video': 'names.noVideo',
      'several-videos': 'names.severalVideos',
      disc: 'names.disc',
      'no-episodes': 'names.noEpisodes',
      'same-place': 'names.samePlace',
      split: 'names.split',
    }
    for (const [reason, key] of Object.entries(reasons)) expect(notNamedText(reason as NotNamedReason, t)).toBe(key)
  })
})
