import { act, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { MainData, Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type * as progressBar from '../components/ProgressBar'
import { stubDesktop } from '../lib/stubDesktop'
import { resetSettings, updateSettings } from '../settings/settings'
import { mainData, searchPage, torrent as fixtureTorrent } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { DownloadsScreen } from './DownloadsScreen'

// Every row, table row and card renders one progress bar, named after its download: counting the
// bar's renders counts the row's.
const renders = vi.hoisted(() => new Map<string, number>())
vi.mock('../components/ProgressBar', async (importOriginal) => {
  const actual = await importOriginal<typeof progressBar>()
  return {
    ...actual,
    ProgressBar: (props: progressBar.ProgressBarProps): ReactElement => {
      renders.set(props.label, (renders.get(props.label) ?? 0) + 1)
      return <actual.ProgressBar {...props} />
    },
  }
})

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getMainData: vi.fn(),
}))

vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  searchTitles: vi.fn(),
}))

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

const getMainData = vi.mocked(api.getMainData)

const torrent = (hash: string, fields: Partial<Torrent>) => fixtureTorrent(hash, { size: 1_000_000_000, added_on: 0, ...fields })

const SNAPSHOT: MainData = mainData([
  torrent('dune', { name: 'Dune.Part.Two.2024.2160p.WEB-DL', progress: 0.42, dlspeed: 4_300_000, eta: 720 }),
  torrent('andor', { name: 'Andor.S02.1080p', state: 'uploading', progress: 1, upspeed: 120_000 }),
  torrent('alien', { name: 'Alien.Romulus.2024.1080p', state: 'stoppedDL', progress: 0.1 }),
])

/**
 * The next poll as qBittorrent answers it: a download's speed and time left changed, and a seed got
 * only the fields it reports for every running torrent, none of which the app reads.
 */
const DELTA = {
  rid: 2,
  torrents: {
    dune: { dlspeed: 5_100_000, eta: 600 },
    andor: { time_active: 5_000, seeding_time: 4_000, reannounce: 1_700, popularity: 0.4 },
  },
} as MainData

const LAYOUTS = [
  { name: 'phone list', desktop: false, settings: {} },
  { name: 'phone grid', desktop: false, settings: { downloadsView: 'grid' } },
  { name: 'desktop table', desktop: true, settings: { downloadsDesktopView: 'list' } },
  { name: 'desktop grid', desktop: true, settings: {} },
] as const

const rendersOf = (name: string) => renders.get(`${name}: progress`) ?? 0

beforeEach(() => {
  vi.resetAllMocks()
  renders.clear()
  clearTitleMatchCache()
  resetServerMatches()
  resetSettings()
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([]))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DownloadsScreen on a poll', () => {
  it.each(LAYOUTS)('renders again only the download whose shown fields changed, in the $name', async (layout) => {
    if (layout.desktop) stubDesktop()
    updateSettings(layout.settings)
    getMainData.mockResolvedValueOnce(SNAPSHOT).mockResolvedValue(DELTA)
    renderWithRouter(<DownloadsScreen onSessionLost={vi.fn()} />)
    await screen.findByRole('progressbar', { name: 'Alien.Romulus.2024.1080p: progress' })
    // The title lookups have answered (none found), so nothing but the poll renders the rows.
    await waitFor(() => expect(tmdb.searchTitles).toHaveBeenCalledTimes(3))
    await act(async () => {})
    const before = { dune: rendersOf('Dune.Part.Two.2024.2160p.WEB-DL'), andor: rendersOf('Andor.S02.1080p'), alien: rendersOf('Alien.Romulus.2024.1080p') }

    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(rendersOf('Dune.Part.Two.2024.2160p.WEB-DL')).toBeGreaterThan(before.dune))
    expect(screen.getAllByText(/5\.1 MB\/s/).length).toBeGreaterThan(0)
    expect(rendersOf('Andor.S02.1080p')).toBe(before.andor)
    expect(rendersOf('Alien.Romulus.2024.1080p')).toBe(before.alien)
  })
})
