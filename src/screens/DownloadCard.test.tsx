import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import i18n from '../i18n'
import { DUNE_TORRENT } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import type { TitleMatch } from '../torrents/titleLookup'
import { DownloadCard } from './DownloadCard'
import type { DownloadItemProps } from './DownloadItem'

const DUNE_MATCH: TitleMatch = { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, posterPath: '/dune.jpg' }

function renderCard(props: Partial<DownloadItemProps> = {}, torrent: Torrent = DUNE_TORRENT) {
  const onMore = vi.fn()
  const { container } = renderWithRouter(
    <ul>
      <DownloadCard torrent={torrent} onMore={onMore} {...props} />
    </ul>,
  )
  // The last one rendered, when a test renders several.
  return { onMore, container, card: within(screen.getAllByRole('listitem').at(-1)!) }
}

describe('DownloadCard', () => {
  it('follows the language while memoized', async () => {
    const { card } = renderCard()
    await act(() => i18n.changeLanguage('ru'))
    expect(card.getByText('Загружается')).toBeInTheDocument()
  })

  it('shows the title over the poster with the status, progress and speed, linking to the torrent', () => {
    const { card, container } = renderCard({ match: DUNE_MATCH })
    expect(card.getByRole('heading')).toHaveTextContent('Dune: Part Two')
    expect(card.getByText('42% · ↓ 4.3 MB/s')).toBeInTheDocument()
    expect(card.getByText('Downloading')).toBeInTheDocument()
    expect(card.getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(card.getByLabelText('Queue position 1')).toBeInTheDocument()
    expect(card.getByRole('link')).toHaveAttribute('href', '/torrent/dune')
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w342/dune.jpg')
  })

  it('shows the release name and the size until a title is matched, and the upload speed when seeding', () => {
    const paused = renderCard({ showQueue: false }, { ...DUNE_TORRENT, state: 'stoppedDL', progress: 0.1 })
    expect(paused.card.getByRole('heading', { name: 'Dune.Part.Two.2024.2160p.WEB-DL' })).toBeInTheDocument()
    expect(paused.card.getByText('10% · 20.0 GB')).toBeInTheDocument()
    expect(paused.card.getByText('Paused')).toBeInTheDocument()
    expect(paused.card.queryByLabelText(/Queue position/)).not.toBeInTheDocument()
    expect(paused.container.querySelector('img')).toBeNull()

    const seeding = renderCard({}, { ...DUNE_TORRENT, hash: 'andor', state: 'uploading', progress: 1 })
    expect(seeding.card.getByText('100% · ↑ 120 KB/s')).toBeInTheDocument()
  })

  it('marks the torrent’s own speed limits, whatever it is doing', () => {
    const downloading = renderCard({}, { ...DUNE_TORRENT, dl_limit: 5_000_000 })
    expect(downloading.card.getByRole('img', { name: 'Speed limit: download up to 5.0\u00a0MB/s' })).toBeInTheDocument()

    const paused = renderCard({}, { ...DUNE_TORRENT, hash: 'alien', state: 'stoppedDL', progress: 0.1, up_limit: 500_000 })
    expect(paused.card.getByRole('img', { name: 'Speed limit: upload up to 500\u00a0KB/s' })).toBeInTheDocument()
  })

  it('opens the actions from More, as a menu where there is a pause button', async () => {
    const { card, onMore } = renderCard()
    const more = card.getByRole('button', { name: 'More actions: Dune.Part.Two.2024.2160p.WEB-DL' })
    expect(more).not.toHaveAttribute('aria-haspopup')
    await userEvent.click(more)
    expect(onMore).toHaveBeenCalledWith(DUNE_TORRENT, more)

    const desktop = renderCard({ onToggleRunning: vi.fn() })
    expect(desktop.card.getByRole('button', { name: /More actions/ })).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('pauses or resumes from a button of its own only where asked for, unless disabled', async () => {
    const phone = renderCard()
    expect(phone.card.queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument()

    const onToggleRunning = vi.fn()
    const desktop = renderCard({ onToggleRunning })
    await userEvent.click(desktop.card.getByRole('button', { name: 'Pause: Dune.Part.Two.2024.2160p.WEB-DL' }))
    expect(onToggleRunning).toHaveBeenCalledWith(DUNE_TORRENT)

    const offline = renderCard({ onToggleRunning, disabled: true }, { ...DUNE_TORRENT, state: 'stoppedDL' })
    expect(offline.card.getByRole('button', { name: /^Resume/ })).toBeDisabled()
  })

  it('is a checkbox while selecting, without the link or the buttons', async () => {
    const onToggle = vi.fn()
    const { card } = renderCard({ match: DUNE_MATCH, selected: false, onToggle, onToggleRunning: vi.fn() })
    expect(card.queryByRole('link')).not.toBeInTheDocument()
    expect(card.queryByRole('button', { name: /More actions|Pause/ })).not.toBeInTheDocument()
    await userEvent.click(card.getByRole('checkbox', { name: 'Dune: Part Two' }))
    expect(onToggle).toHaveBeenCalledWith(DUNE_TORRENT)
  })
})
