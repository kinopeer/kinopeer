import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/settings'
import type { DownloadDefaults, ServerSettings } from '../api/settings'
import i18n from '../i18n'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  getSettings,
  initSettingsSync,
  loadServerSettings,
  resetSettings,
  useSettings,
  useTmdbLanguage,
} from './settings'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getServerSettings: vi.fn(),
  saveDownloadDefaults: vi.fn(),
}))

function server(downloads: Partial<DownloadDefaults> | null): ServerSettings {
  return { tmdb: { configured: true, source: 'saved', fallback: null }, prowlarr: { configured: true, source: 'env', serverKey: true }, qbittorrent: { configured: true, source: 'env' }, downloads }
}

beforeEach(() => {
  // The previous test's hooks may have read the settings again while unmounting.
  resetSettings()
  // No Kinoseed server unless a test sets one up.
  vi.mocked(api.getServerSettings).mockRejectedValue(new api.SettingsError(404))
  vi.mocked(api.saveDownloadDefaults).mockRejectedValue(new api.SettingsError(404))
})

afterEach(async () => {
  resetSettings()
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('settings', () => {
  it('starts from the defaults and keeps changes in localStorage', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ movieCategory: 'Movies', startPaused: true }))
    expect(result.current[0]).toMatchObject({ movieCategory: 'Movies', startPaused: true, sequential: false })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ movieCategory: 'Movies' })
  })

  it('shows downloads as a list until a grid is picked, and remembers the pick', () => {
    expect(getSettings().downloadsView).toBe('list')
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsView: 'grid' }))
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ downloadsView: 'grid' })
    resetSettings()
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ downloadsView: 'grid' }))
    expect(getSettings().downloadsView).toBe('grid')
  })

  it('shows downloads on desktop as a grid until a list is picked, apart from the phone view', () => {
    expect(getSettings().downloadsDesktopView).toBe('grid')
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsDesktopView: 'list' }))
    expect(result.current[0]).toMatchObject({ downloadsView: 'list', downloadsDesktopView: 'list' })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ downloadsDesktopView: 'list' })
  })

  it('orders downloads by the queue until another sort is picked, and remembers the pick', () => {
    expect(getSettings().downloadsSort).toBe('priority')
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsSort: 'added' }))
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ downloadsSort: 'added' })
  })

  it('remembers the sort with its direction, and reads a sort stored without one in its usual direction', () => {
    const reread = (stored: string) => {
      resetSettings()
      localStorage.setItem(SETTINGS_STORAGE_KEY, stored)
      return getSettings()
    }
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsSort: 'size', downloadsSortDescending: false }))
    expect(reread(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
      downloadsSort: 'size',
      downloadsSortDescending: false,
    })
    // Saved before the sort had a direction; knownOrder's tests own the rest of what's checked.
    expect(reread(JSON.stringify({ downloadsSort: 'size' }))).toMatchObject({
      downloadsSort: 'size',
      downloadsSortDescending: true,
    })
  })

  it('ignores unreadable storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json')
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps only the release filters and sort it knows from storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ releaseFilters: { resolution: null, audio: ['dub', 'x'] }, releaseSort: 'size' }))
    expect(getSettings()).toMatchObject({
      releaseFilters: { resolution: [], audio: ['dub'], source: [], minSeeds: 0 },
      releaseSort: { key: 'seeds', descending: true },
    })
  })

  it('follows the app language for TMDB unless one is chosen', async () => {
    const { result } = renderHook(() => [useTmdbLanguage(), useSettings()[1]] as const)
    expect(result.current[0]).toBe('en-US')
    await act(() => i18n.changeLanguage('ru'))
    expect(result.current[0]).toBe('ru-RU')
    act(() => result.current[1]({ tmdbLanguage: 'en-US' }))
    expect(result.current[0]).toBe('en-US')
  })
})

describe('settings saved in another tab', () => {
  let stop: () => void
  beforeEach(() => {
    stop = initSettingsSync()
  })
  afterEach(() => stop())

  const SIZE_SORT = { releaseSort: { key: 'size', descending: false } }
  // What another tab's save looks like here: storage changed, then an event about it.
  function saveElsewhere(stored: object, key: string | null = SETTINGS_STORAGE_KEY, storageArea: Storage = localStorage) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored))
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea }))
  }

  it('takes a change saved in another tab, and keeps it through a change here', () => {
    const { result } = renderHook(() => useSettings())
    act(() => saveElsewhere(SIZE_SORT))
    expect(result.current[0].releaseSort).toEqual({ key: 'size', descending: false })
    act(() => result.current[1]({ downloadsView: 'grid' }))
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ ...SIZE_SORT, downloadsView: 'grid' })
  })

  it('goes back to the defaults when another tab clears storage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => saveElsewhere(SIZE_SORT))
    act(() => {
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
    })
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores a change to another key or to session storage', () => {
    const { result } = renderHook(() => useSettings())
    act(() => saveElsewhere(SIZE_SORT, 'kinoseed.theme'))
    act(() => saveElsewhere(SIZE_SORT, null, sessionStorage))
    expect(result.current[0].releaseSort).toEqual(DEFAULT_SETTINGS.releaseSort)
  })

  it('stops following other tabs once stopped', () => {
    const { result } = renderHook(() => useSettings())
    stop()
    act(() => saveElsewhere(SIZE_SORT))
    expect(result.current[0].releaseSort).toEqual(DEFAULT_SETTINGS.releaseSort)
  })

  it('keeps the settings it has when another tab saved the same', () => {
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsView: 'grid' }))
    const before = result.current[0]
    act(() => saveElsewhere({ ...before }))
    expect(result.current[0]).toBe(before)
  })
})

describe('download defaults on the server', () => {
  it("takes the server's defaults and keeps this browser's other preferences", async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ movieCategory: 'Old', downloadsView: 'grid' }))
    vi.mocked(api.getServerSettings).mockResolvedValue(
      server({ movieCategory: null, tvCategory: 'TV Shows', startPaused: true, sequential: false }),
    )

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current[0].tvCategory).toBe('TV Shows'))
    expect(result.current[0]).toEqual({ ...DEFAULT_SETTINGS, tvCategory: 'TV Shows', startPaused: true, downloadsView: 'grid' })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ startPaused: true, tvCategory: 'TV Shows' })
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
    expect(api.getServerSettings).toHaveBeenCalledTimes(1)

    // Once per page.
    renderHook(() => useSettings())
    expect(api.getServerSettings).toHaveBeenCalledTimes(1)
  })

  it('sends the defaults this browser changed that the server has none of yet', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ movieCategory: 'Movies', sequential: true, downloadsView: 'grid' }))
    vi.mocked(api.getServerSettings).mockResolvedValue(server({ sequential: false }))
    vi.mocked(api.saveDownloadDefaults).mockResolvedValue(server({ sequential: false, movieCategory: 'Movies' }))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(api.saveDownloadDefaults).toHaveBeenCalledWith({ movieCategory: 'Movies' }))
    expect(result.current[0]).toMatchObject({ movieCategory: 'Movies', sequential: false })
  })

  it('sends nothing when the server has none and this browser kept the defaults', async () => {
    vi.mocked(api.getServerSettings).mockResolvedValue(server(null))
    renderHook(() => useSettings())
    await waitFor(() => expect(api.getServerSettings).toHaveBeenCalled())
    await act(() => Promise.resolve())
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
  })

  it('saves a changed download default on the server, and nothing else', () => {
    const { result } = renderHook(() => useSettings())

    act(() => result.current[1]({ startPaused: true }))
    expect(api.saveDownloadDefaults).toHaveBeenLastCalledWith({ startPaused: true })
    act(() => result.current[1]({ movieCategory: undefined }))
    expect(api.saveDownloadDefaults).toHaveBeenLastCalledWith({ movieCategory: null })

    vi.mocked(api.saveDownloadDefaults).mockClear()
    act(() => result.current[1]({ downloadsView: 'grid', downloadsSort: 'name', tmdbLanguage: 'ru-RU' }))
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
  })

  it("doesn't let the server's defaults undo a change made while they were loading", async () => {
    let answer!: (settings: ServerSettings) => void
    vi.mocked(api.getServerSettings).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    vi.mocked(api.saveDownloadDefaults).mockResolvedValue(server(null))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(api.getServerSettings).toHaveBeenCalled())

    act(() => result.current[1]({ startPaused: true }))
    await act(async () => answer(server({ startPaused: false, sequential: true })))

    expect(result.current[0]).toMatchObject({ startPaused: true, sequential: true })
  })

  it("works from this browser's settings without a server, and asks again a minute later", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ startPaused: true }))
      const { result } = renderHook(() => useSettings())
      await act(() => Promise.resolve())
      expect(result.current[0].startPaused).toBe(true)

      act(() => result.current[1]({ sequential: true }))
      expect(result.current[0].sequential).toBe(true)

      await act(async () => loadServerSettings())
      expect(api.getServerSettings).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 61_000)
      await act(async () => loadServerSettings())
      expect(api.getServerSettings).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
