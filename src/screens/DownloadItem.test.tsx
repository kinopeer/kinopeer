import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { DUNE_TORRENT } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import type { TitleMatch } from '../torrents/titleMatches'
import { DownloadItem, type DownloadItemProps } from './DownloadItem'

const DUNE_MATCH: TitleMatch ={ type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, posterPath: '/dune.jpg' }

function renderItem(props: Partial<DownloadItemProps> = {}, torrent: Torrent = DUNE_TORRENT) {
  const onMore = vi.fn()
  const { container } = renderWithRouter(
    <ul>
      <DownloadItem torrent={torrent} onMore={onMore} {...props} />
    </ul>,
  )
  // The last one rendered, when a test renders several.
  return { onMore, container, item: within(screen.getAllByRole('listitem').at(-1)!) }
}

describe('DownloadItem', () => {
  it('shows the title with its year and the release name under it, and the poster', () => {
    const { item, container } = renderItem({ match: DUNE_MATCH })
    expect(item.getByRole('heading')).toHaveTextContent('Dune: Part Two2024')
    expect(item.getByText('Dune.Part.Two.2024.2160p.WEB-DL')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w185/dune.jpg')
    expect(item.getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toBeInTheDocument()
  })

  it('shows the release name alone and a placeholder poster until a title is matched', () => {
    const { item, container } = renderItem()
    expect(item.getByRole('heading')).toHaveTextContent(/^Dune\.Part\.Two\.2024\.2160p\.WEB-DL$/)
    expect(container.querySelector('img')).toBeNull()
    expect(item.getByRole('progressbar', { name: 'Dune.Part.Two.2024.2160p.WEB-DL: progress' })).toBeInTheDocument()
  })

  it('shows the progress, status, speed, time left and what is downloaded of the size', () => {
    const { item } = renderItem()
    expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(item.getByText('42%')).toBeInTheDocument()
    expect(item.getByText('Downloading')).toBeInTheDocument()
    expect(item.getByText('↓ 4.3 MB/s')).toBeInTheDocument()
    expect(item.getByText('12 min')).toBeInTheDocument()
    expect(item.getByText('8.40 GB / 20.0 GB')).toBeInTheDocument()
  })

  it('shows the upload speed and the plain size when seeding, and no speed when paused', () => {
    const seeding = renderItem({}, { ...DUNE_TORRENT, state: 'uploading', progress: 1 })
    expect(seeding.item.getByText('Seeding')).toBeInTheDocument()
    expect(seeding.item.getByText('↑ 120 KB/s')).toBeInTheDocument()
    expect(seeding.item.getByText('20.0 GB')).toBeInTheDocument()
    expect(seeding.item.queryByText(/min$/)).not.toBeInTheDocument()

    const paused = renderItem({}, { ...DUNE_TORRENT, hash: 'alien', state: 'stoppedDL', progress: 0.1 })
    expect(paused.item.getByText('Paused')).toBeInTheDocument()
    expect(paused.item.queryByText(/MB\/s|KB\/s/)).not.toBeInTheDocument()
    expect(paused.item.getByText('2.00 GB / 20.0 GB')).toBeInTheDocument()
  })

  it('marks the torrent’s own speed limits on the speed’s row, next to the speed when there is one', () => {
    const downloading = renderItem({}, { ...DUNE_TORRENT, dl_limit: 5_000_000 })
    const mark = downloading.item.getByRole('img', { name: 'Speed limit: download up to 5.0\u00a0MB/s' })
    // On the download's own row for its speed and time left.
    expect(downloading.item.getByText('↓ 4.3 MB/s').parentElement).toContainElement(mark)

    // A seed's speed moves to a row of its own with the mark, which the status's row has no room
    // for on a phone; without limits it stays next to the status.
    const seeding = renderItem({}, { ...DUNE_TORRENT, hash: 'andor', state: 'uploading', progress: 1, up_limit: 500_000 })
    const seedSpeed = seeding.item.getByText('↑ 120 KB/s').parentElement
    expect(seedSpeed).toContainElement(seeding.item.getByRole('img', { name: 'Speed limit: upload up to 500\u00a0KB/s' }))
    expect(seedSpeed).not.toContainElement(seeding.item.getByText('Seeding'))
    const unlimited = renderItem({}, { ...DUNE_TORRENT, hash: 'rogue', state: 'uploading', progress: 1 })
    expect(unlimited.item.getByText('↑ 120 KB/s').parentElement).toContainElement(unlimited.item.getByText('Seeding'))

    // A limit isn't about what the torrent is doing: a paused one with only an upload limit shows it
    // too, on that row as well, without a speed.
    const paused = renderItem({}, { ...DUNE_TORRENT, hash: 'alien', state: 'stoppedDL', up_limit: 500_000 })
    const pausedMark = paused.item.getByRole('img', { name: 'Speed limit: upload up to 500\u00a0KB/s' })
    expect(pausedMark.parentElement).toHaveTextContent(/^↑$/)
  })

  it('shows the queue position only in the queue order, and only for queued torrents', () => {
    expect(renderItem().item.getByLabelText('Queue position 1')).toHaveTextContent('#1')
    expect(renderItem({ showQueue: false }).item.queryByLabelText(/Queue position/)).not.toBeInTheDocument()
    expect(renderItem({}, { ...DUNE_TORRENT, priority: 0 }).item.queryByLabelText(/Queue position/)).not.toBeInTheDocument()
  })

  it('opens the torrent from the row and its actions from More', async () => {
    const { item, onMore } = renderItem({ match: DUNE_MATCH })
    expect(item.getByRole('link')).toHaveAttribute('href', '/torrent/dune')
    const more = item.getByRole('button', { name: 'More actions: Dune: Part Two' })
    await userEvent.click(more)
    expect(onMore).toHaveBeenCalledWith(DUNE_TORRENT, more)
  })

  it('is a checkbox named after the title while selecting, with no link or More', async () => {
    const onToggle = vi.fn()
    const { item } = renderItem({ match: DUNE_MATCH, selected: false, onToggle })
    expect(item.queryByRole('link')).not.toBeInTheDocument()
    expect(item.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    await userEvent.click(item.getByRole('checkbox', { name: 'Dune: Part Two' }))
    expect(onToggle).toHaveBeenCalledWith(DUNE_TORRENT)
  })
})
