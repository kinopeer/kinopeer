import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { stubDesktop } from '../lib/stubDesktop'
import { renderWithRouter } from '../test/render'
import * as titleMatches from '../torrents/titleMatches'
import { TorrentActionsSheet, type TorrentActionsSheetProps } from './TorrentActionsSheet'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  stopTorrents: vi.fn(),
  startTorrents: vi.fn(),
}))

vi.mock('../torrents/titleMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof titleMatches>()),
  chooseTitle: vi.fn(),
}))

const TORRENT = { hash: 'b1', name: 'Inception.2010.1080p', state: 'stoppedDL', progress: 0.3 } as Torrent
const MATCH: titleMatches.TitleMatch = { type: 'movie', id: 27205, title: 'Inception', year: 2010, posterPath: null }

function renderActions(props: Partial<TorrentActionsSheetProps> = {}) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  const handlers = {
    onClose: vi.fn(),
    onChanged: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onChangeTitle: vi.fn(),
    onConfirmed: vi.fn(),
  }
  renderWithRouter(<TorrentActionsSheet torrent={TORRENT} match={MATCH} offline={false} anchor={anchor} {...handlers} {...props} />)
  return handlers
}

beforeEach(() => {
  vi.resetAllMocks()
  stubDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('TorrentActionsSheet on desktop', () => {
  it('is a menu: resume, details, the title page, change title, move, delete', async () => {
    vi.mocked(api.startTorrents).mockResolvedValue()
    const handlers = renderActions()
    const menu = screen.getByRole('menu', { name: 'More actions: Inception' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Resume',
      'Open details',
      'Movie page',
      'Change title',
      'Move files…',
      'Delete',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Resume' }))
    expect(api.startTorrents).toHaveBeenCalledWith(['b1'])
    expect(handlers.onChanged).toHaveBeenCalled()
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it('asks about a guessed title with Change and "Yes, right"', async () => {
    vi.mocked(titleMatches.chooseTitle).mockResolvedValue()
    const handlers = renderActions({ guessed: true })
    const group = screen.getByRole('group', { name: 'Matched by the release name. Is it right?' })
    expect(screen.queryByRole('menuitem', { name: 'Change title' })).not.toBeInTheDocument()
    await userEvent.click(within(group).getByRole('menuitem', { name: 'Change' }))
    expect(handlers.onChangeTitle).toHaveBeenCalled()
    await userEvent.click(within(group).getByRole('menuitem', { name: 'Yes, right' }))
    expect(titleMatches.chooseTitle).toHaveBeenCalledWith('b1', MATCH, expect.any(String))
    expect(handlers.onConfirmed).toHaveBeenCalled()
  })

  it('shows a failure under the items', async () => {
    vi.mocked(api.startTorrents).mockRejectedValue(new Error('500'))
    renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
    expect(await screen.findByText('Couldn’t reach qBittorrent. Try again.')).toBeInTheDocument()
  })

  it('opens Move files', async () => {
    const handlers = renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move files…' }))
    expect(handlers.onMove).toHaveBeenCalled()
  })

  it('needs qBittorrent to move files', () => {
    renderActions({ offline: true })
    expect(screen.getByRole('menuitem', { name: 'Move files…' })).toBeDisabled()
  })

  it('is a sheet without an anchor or on a phone', async () => {
    vi.unstubAllGlobals()
    const handlers = renderActions()
    expect(screen.getByRole('dialog', { name: 'Inception' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move files…' }))
    expect(handlers.onMove).toHaveBeenCalled()
  })

  it('needs qBittorrent to move files on a phone too', () => {
    vi.unstubAllGlobals()
    renderActions({ offline: true })
    expect(screen.getByRole('button', { name: 'Move files…' })).toBeDisabled()
  })
})
