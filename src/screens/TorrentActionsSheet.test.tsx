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
  setSpeedLimits: vi.fn(),
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
  it('opens the speed limits sheet in place of the menu', async () => {
    renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Speed limits' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Speed limits' })).toBeInTheDocument()
  })

  it('disables the speed limits while a pause or resume is in flight, so its closing can\'t drop the sheet', async () => {
    vi.mocked(api.startTorrents).mockReturnValue(new Promise(() => {}))
    renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
    expect(screen.getByRole('menuitem', { name: 'Speed limits' })).toBeDisabled()
  })

  it('disables the speed limits while qBittorrent is offline', () => {
    renderActions({ offline: true })
    expect(screen.getByRole('menuitem', { name: 'Speed limits' })).toBeDisabled()
  })

  it('is a menu: resume, speed limits, details, the title page, change title, delete', async () => {
    vi.mocked(api.startTorrents).mockResolvedValue()
    const handlers = renderActions()
    const menu = screen.getByRole('menu', { name: 'More actions: Inception' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Resume',
      'Speed limits',
      'Open details',
      'Movie page',
      'Change title',
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

  it('is a sheet without an anchor or on a phone', () => {
    vi.unstubAllGlobals()
    renderActions()
    expect(screen.getByRole('dialog', { name: 'Inception' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables the speed limits on the phone sheet while a pause or resume is in flight', async () => {
    vi.unstubAllGlobals()
    vi.mocked(api.startTorrents).mockReturnValue(new Promise(() => {}))
    renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('button', { name: 'Speed limits' })).toBeDisabled()
  })

  it('opens the speed limits sheet from the phone sheet', async () => {
    vi.unstubAllGlobals()
    renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Speed limits' }))
    expect(screen.getByRole('dialog', { name: 'Speed limits' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Inception' })).not.toBeInTheDocument()
  })
})
