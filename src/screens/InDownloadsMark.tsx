import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Badge } from '../components/Badge'
import { useFormatters } from '../lib/format'
import { downloadsMark } from '../torrents/titleDownloads'
import './InDownloadsMark.css'
import { inDownloadsText, inDownloadsValue } from './inDownloadsText'

export interface InDownloadsMarkProps {
  /** The title's torrents; nothing shows without any. */
  torrents: readonly Pick<Torrent, 'progress'>[] | undefined
}

/** Over a title card's poster: the title is in downloads, by the title page header's rule (#460). */
export function InDownloadsMark({ torrents }: InDownloadsMarkProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const mark = downloadsMark(torrents ?? [])
  if (!mark) return null
  // Dark tokens in both themes, like the poster's other overlays: it sits on the image. The header's
  // words don't fit a card ("In downloads · 100%" takes 156px, a row's card has 140px for it), so
  // the card shows the download icon and the figure, and a screen reader reads the words.
  return (
    <span className="in-dl-mark" data-theme="dark">
      <Badge kind="coverage" icon="download">
        <span aria-hidden="true">{inDownloadsValue(format, mark)}</span>
        <span className="sr-only">{inDownloadsText(t, format, mark)}</span>
      </Badge>
    </span>
  )
}
