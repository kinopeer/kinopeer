import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Badge } from '../components/Badge'
import { useFormatters } from '../lib/format'
import { downloadsMark } from '../torrents/titleDownloads'
import './InDownloadsMark.css'
import { inDownloadsText } from './inDownloadsText'

export interface InDownloadsMarkProps {
  /** The title's torrents; nothing shows without any. */
  torrents: readonly Pick<Torrent, 'progress'>[] | undefined
}

/** Over a title card's poster: the title is in downloads, as the title page's header says (#460). */
export function InDownloadsMark({ torrents }: InDownloadsMarkProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const mark = downloadsMark(torrents ?? [])
  if (!mark) return null
  // Dark tokens in both themes, like the poster's other overlays: it sits on the image.
  return (
    <span className="in-dl-mark" data-theme="dark">
      <Badge kind="coverage" icon="check">
        {inDownloadsText(t, format, mark)}
      </Badge>
    </span>
  )
}
