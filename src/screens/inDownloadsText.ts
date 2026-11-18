import type { TFunction } from 'i18next'
import type { Formatters } from '../lib/format'
import type { DownloadsMark } from '../torrents/titleDownloads'

/** The mark's figure: one torrent's progress ("45%"), or how many torrents there are ("3"). */
export function inDownloadsValue(format: Formatters, mark: DownloadsMark): string {
  return 'count' in mark ? String(mark.count) : format.percent(mark.progress)
}

/** "In downloads · 45%" for one torrent, "In downloads · 3" for several. */
export function inDownloadsText(t: TFunction, format: Formatters, mark: DownloadsMark): string {
  return t('title.inDownloadsBadge', { value: inDownloadsValue(format, mark) })
}
