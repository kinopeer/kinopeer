import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as settings from '../api/settings'
import { useNotificationsAvailable } from './useNotificationsAvailable'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof settings>()),
  getServerSettings: vi.fn(),
}))

const WITH_NOTIFICATIONS: settings.ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: null },
  prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
  downloads: null,
  notifications: true,
}

describe('useNotificationsAvailable', () => {
  it('offers the switch when the server has a channel set up', async () => {
    vi.mocked(settings.getServerSettings).mockResolvedValue(WITH_NOTIFICATIONS)
    const { result } = renderHook(() => useNotificationsAvailable())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('never offers it in the WebUI build, which has no server to notify, and asks nothing', async () => {
    vi.stubGlobal('__WEBUI__', true)
    vi.mocked(settings.getServerSettings).mockResolvedValue(WITH_NOTIFICATIONS)
    const { result } = renderHook(() => useNotificationsAvailable())
    expect(result.current).toBe(false)
    expect(settings.getServerSettings).not.toHaveBeenCalled()
  })
})
