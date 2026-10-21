import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import { DownloadsScreen } from './DownloadsScreen'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, getMainData: vi.fn() }
})

const getMainData = vi.mocked(api.getMainData)

function torrent(hash: string, fields: Partial<Torrent>): Partial<Torrent> {
  return {
    name: hash,
    state: 'downloading',
    progress: 0,
    size: 1_000_000_000,
    dlspeed: 0,
    upspeed: 0,
    eta: 8_640_000,
    priority: -1,
    added_on: 0,
    ...fields,
  }
}

const SNAPSHOT: MainData = {
  rid: 1,
  full_update: true,
  torrents: {
    dune: torrent('dune', {
      name: 'Dune.Part.Two.2024.2160p.WEB-DL',
      progress: 0.42,
      dlspeed: 4_300_000,
      eta: 720,
      priority: 1,
      size: 21_400_000_000,
    }),
    andor: torrent('andor', { name: 'Andor.S02.1080p', state: 'uploading', progress: 1, upspeed: 120_000 }),
    alien: torrent('alien', { name: 'Alien.Romulus.2024.1080p', state: 'stoppedDL', progress: 0.1 }),
  },
  server_state: { dl_info_speed: 4_300_000, up_info_speed: 120_000, free_space_on_disk: 1_210_000_000_000 },
}

function renderScreen() {
  return render(<DownloadsScreen onSessionLost={vi.fn()} />)
}

beforeEach(() => {
  vi.resetAllMocks()
  getMainData.mockResolvedValue(SNAPSHOT)
})

describe('DownloadsScreen', () => {
  it('shows a loading state, then the torrents in queue order', async () => {
    getMainData.mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Loading downloads')
    unmount()

    renderScreen()
    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Dune.Part.Two.2024.2160p.WEB-DL',
      'Andor.S02.1080p',
      'Alien.Romulus.2024.1080p',
    ])
  })

  it('shows progress, speed, ETA and size for a download', async () => {
    renderScreen()
    const [dune] = await screen.findAllByRole('listitem')
    const row = within(dune)
    expect(row.getByRole('progressbar', { name: 'Dune.Part.Two.2024.2160p.WEB-DL: progress' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(row.getByText('42%')).toBeInTheDocument()
    expect(row.getByText('Downloading')).toBeInTheDocument()
    expect(row.getByText('↓ 4.3 MB/s')).toBeInTheDocument()
    expect(row.getByText('12 min')).toBeInTheDocument()
    expect(row.getByText('8.99 GB / 21.4 GB')).toBeInTheDocument()
    expect(row.getByLabelText('Queue position 1')).toBeInTheDocument()
  })

  it('shows transfer totals and free space', async () => {
    renderScreen()
    expect(await screen.findByText('1.21 TB free')).toBeInTheDocument()
    expect(screen.getByText('Download speed').parentElement).toHaveTextContent('4.3 MB/s')
    expect(screen.getByText('Upload speed').parentElement).toHaveTextContent('120 KB/s')
  })

  it('filters by status with counts', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    const filters = within(screen.getByRole('group', { name: 'Filter by status' }))
    expect(filters.getByRole('button', { name: 'All 3', pressed: true })).toBeInTheDocument()

    await userEvent.click(filters.getByRole('button', { name: 'Seeding 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Andor.S02.1080p' })).toBeInTheDocument()

    await userEvent.click(filters.getByRole('button', { name: 'Error 0' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('filters by name', async () => {
    renderScreen()
    await screen.findAllByRole('listitem')
    await userEvent.click(screen.getByRole('button', { name: 'Filter by name', pressed: false }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter by name' }), 'alien')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Filter by name', pressed: true }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows the empty state without torrents', async () => {
    getMainData.mockResolvedValue({ rid: 1, full_update: true })
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'No downloads yet' })).toBeInTheDocument()
  })

  it('offers a retry when qBittorrent stops answering', async () => {
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await screen.findByText('No connection to qBittorrent')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('No connection to qBittorrent')).not.toBeInTheDocument()
  })
})
