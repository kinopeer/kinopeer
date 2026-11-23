import type { TFunction } from 'i18next'
import type { NotNamedReason } from '../torrents/mediaNames'

/** Why a torrent's files aren't named for a media server, as the naming sheet and the add sheet's switch say it. */
export function notNamedText(reason: NotNamedReason, t: TFunction): string {
  return { 'no-video': t('names.noVideo'), 'several-videos': t('names.severalVideos'), disc: t('names.disc'), 'sample-title': t('names.sampleTitle') }[reason]
}
