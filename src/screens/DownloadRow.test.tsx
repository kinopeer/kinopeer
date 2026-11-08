import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import i18n from '../i18n'
import { DUNE_TORRENT } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import type { TitleMatch } from '../torrents/titleMatches'
import type { DownloadItemProps } from './DownloadItem'
import { DownloadRow, DownloadRowHeader } from './DownloadRow'

const DUNE_MATCH: TitleMatch = { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, posterPath: '/dune.jpg' }

function renderRow(props: Partial<DownloadItemProps> = {}, torrent: Torrent = DUNE_TORRENT) {
  const onMore = vi.fn()
  const onToggleRunning = vi.fn()
  const { container } = renderWithRouter(
    <div role="table" aria-label="Downloads">
      <DownloadRow torrent={torrent} onMore={onMore} onToggleRunning={onToggleRunning} {...props} />
    </div>,
  )
  // The last one rendered, when a test renders several.
  const row = screen.getAllByRole('row').at(-1)!
  return { onMore, onToggleRunning, container, row, cells: within(row).getAllByRole('cell') }
}

describe('DownloadRowHeader', () => {
  const BY_QUEUE = { order: { sort: 'priority', descending: false }, onSort: () => {} } as const

  it('names the columns, with the first one only while selecting or with queue positions', () => {
    const { rerender } = renderWithRouter(<DownloadRowHeader selecting={false} queue={false} {...BY_QUEUE} />)
    const names = () => screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(names()).toEqual(['Poster', 'Name', 'Progress', 'Status', 'Speed', 'ETA', 'Size', 'Actions'])
    rerender(<DownloadRowHeader selecting={false} queue {...BY_QUEUE} />)
    expect(names()[0]).toBe('# Priority')
    rerender(<DownloadRowHeader selecting queue={false} {...BY_QUEUE} />)
    expect(names()[0]).toBe('Select')
    // The checkboxes' column sorts nothing.
    expect(within(screen.getAllByRole('columnheader')[0]).queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes every named column a sort button, and says which one sorts the list', async () => {
    const onSort = vi.fn()
    const { rerender } = renderWithRouter(
      <DownloadRowHeader selecting={false} queue order={{ sort: 'size', descending: true }} onSort={onSort} />,
    )
    const buttons = screen.getAllByRole('columnheader').map((header) => within(header).queryByRole('button')?.textContent ?? null)
    // The queue column's "#" is followed by the sort's name, hidden, so the name still starts with what shows.
    expect(screen.getByRole('button', { name: '# Priority' })).toBeInTheDocument()
    expect(buttons).toEqual(['# Priority', null, 'Name', 'Progress', 'Status', 'Speed', 'ETA', 'Size', null])
    const sorted = () =>
      screen
        .getAllByRole('columnheader')
        .filter((header) => header.hasAttribute('aria-sort'))
        .map((header) => [header.textContent, header.getAttribute('aria-sort')])
    expect(sorted()).toEqual([['Size', 'descending']])

    await userEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSort).toHaveBeenCalledWith('name')

    rerender(<DownloadRowHeader selecting={false} queue order={{ sort: 'priority', descending: true }} onSort={onSort} />)
    expect(sorted()).toEqual([['# Priority', 'descending']])
    rerender(<DownloadRowHeader selecting={false} queue order={{ sort: 'eta', descending: false }} onSort={onSort} />)
    expect(sorted()).toEqual([['ETA', 'ascending']])
    await userEvent.click(screen.getByRole('button', { name: 'Status' }))
    expect(onSort).toHaveBeenLastCalledWith('status')
    rerender(<DownloadRowHeader selecting={false} queue order={{ sort: 'status', descending: true }} onSort={onSort} />)
    expect(sorted()).toEqual([['Status', 'descending']])
    // Date added has no column.
    rerender(<DownloadRowHeader selecting={false} queue order={{ sort: 'added', descending: true }} onSort={onSort} />)
    expect(sorted()).toEqual([])
  })
})

describe('DownloadRow', () => {
  it('follows the language while memoized', async () => {
    const { row } = renderRow()
    await act(() => i18n.changeLanguage('ru'))
    expect(within(row).getByText('Загружается')).toBeInTheDocument()
  })

  it('puts the queue position, poster, title with the release, progress, status, speed, time left and size in cells', () => {
    const { row, cells, container } = renderRow({ match: DUNE_MATCH })
    expect(cells).toHaveLength(9)
    expect(within(cells[0]).getByLabelText('Queue position 1')).toHaveTextContent('1')
    // Posters are decorative (alt=""), so they have no role to query by.
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w92/dune.jpg')
    expect(within(row).getByRole('link', { name: /^Dune: Part Two/ })).toHaveAttribute('href', '/torrent/dune')
    expect(cells[2]).toHaveTextContent('Dune: Part Two2024Dune.Part.Two.2024.2160p.WEB-DL')
    expect(within(cells[3]).getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(cells[3]).toHaveTextContent('42%')
    expect(cells[4]).toHaveTextContent('Downloading')
    // The time left has its own column, and a copy under the speed for narrow tables (CSS shows one).
    expect(cells[5]).toHaveTextContent(/^↓ 4\.3 MB\/s12 min$/)
    expect(cells[6]).toHaveTextContent(/^12 min$/)
    expect(cells[7]).toHaveTextContent('8.40 GB / 20.0 GB')
  })

  it('drops the first cell without a queue to show, and dashes out what a paused torrent lacks', () => {
    const { cells } = renderRow({ showQueue: false }, { ...DUNE_TORRENT, state: 'stoppedDL', progress: 1 })
    expect(cells).toHaveLength(8)
    expect(cells[1]).toHaveTextContent(/^Dune\.Part\.Two\.2024\.2160p\.WEB-DL$/)
    expect(cells[3]).toHaveTextContent('Paused')
    expect(cells[4]).toHaveTextContent(/^—$/)
    expect(cells[5]).toHaveTextContent(/^—$/)
    expect(cells[6]).toHaveTextContent(/^20\.0 GB$/)
  })

  it('marks the torrent’s own speed limits in the speed cell, next to the speed or its dash', () => {
    const downloading = renderRow({}, { ...DUNE_TORRENT, dl_limit: 5_000_000, up_limit: 500_000 })
    expect(
      within(downloading.cells[5]).getByRole('img', {
        name: 'Speed limits: download up to 5.0\u00a0MB/s, upload up to 500\u00a0KB/s',
      }),
    ).toBeInTheDocument()

    const paused = renderRow({ showQueue: false }, { ...DUNE_TORRENT, hash: 'alien', state: 'stoppedDL', dl_limit: 5_000_000 })
    expect(paused.cells[4]).toHaveTextContent(/^—↓$/)
    expect(within(paused.cells[4]).getByRole('img', { name: 'Speed limit: download up to 5.0\u00a0MB/s' })).toBeInTheDocument()
  })

  it('pauses a running torrent and resumes a stopped one from its own button, unless disabled', async () => {
    const running = renderRow({ match: DUNE_MATCH })
    await userEvent.click(within(running.row).getByRole('button', { name: 'Pause: Dune: Part Two' }))
    expect(running.onToggleRunning).toHaveBeenCalledWith(DUNE_TORRENT)

    const stopped = renderRow({ disabled: true }, { ...DUNE_TORRENT, hash: 'alien', state: 'stoppedDL' })
    expect(within(stopped.row).getByRole('button', { name: 'Resume: Dune.Part.Two.2024.2160p.WEB-DL' })).toBeDisabled()
  })

  it('opens the actions as a menu from More', async () => {
    const { row, onMore } = renderRow()
    const more = within(row).getByRole('button', { name: 'More actions: Dune.Part.Two.2024.2160p.WEB-DL' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(more)
    expect(onMore).toHaveBeenCalledWith(DUNE_TORRENT, more)
  })

  it('starts with a checkbox while selecting, without the link or the buttons', async () => {
    const onToggle = vi.fn()
    const { row, cells } = renderRow({ match: DUNE_MATCH, selected: true, onToggle })
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    const box = within(cells[0]).getByRole('checkbox', { name: 'Dune: Part Two' })
    expect(box).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(box)
    expect(onToggle).toHaveBeenCalledWith(DUNE_TORRENT)
  })
})
