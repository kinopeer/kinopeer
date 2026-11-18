import type { TFunction } from 'i18next'
import type { Formatters } from '../lib/format'
import type { DownloadsMark } from '../torrents/titleDownloads'

/** "In downloads · 45%" for one torrent, "In downloads · 3" for several. */
export function inDownloadsText(t: TFunction, format: Formatters, mark: DownloadsMark): string {
  return t('title.inDownloadsBadge', { value: 'count' in mark ? mark.count : format.percent(mark.progress) })
}
