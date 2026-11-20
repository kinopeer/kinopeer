import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSettings } from '../api/settings'
import { getSharedServerSettings } from '../api/sharedAnswers'
import { setupSteps, useSetupSteps } from './useSetupSteps'

vi.mock('../api/sharedAnswers', () => ({ getSharedServerSettings: vi.fn() }))

/** The server's settings with everything set: the TMDB key, Prowlarr's address from the environment, the login on. */
const SET: ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: null },
  prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
  downloads: null,
  auth: { enabled: true, source: 'saved' },
}
const noProwlarr: ServerSettings['prowlarr'] = { configured: false, source: null, serverKey: false, address: { source: null } }

describe('setupSteps', () => {
  it('asks nothing when the server has a TMDB key and Prowlarr’s address', () => {
    expect(setupSteps(SET)).toEqual([])
    // A saved address is Prowlarr set up, its key too or not: Settings changes it.
    expect(setupSteps({ ...SET, prowlarr: { ...noProwlarr, address: { source: 'saved', url: 'http://prowlarr.test' } } })).toEqual([])
  })

  it('asks for the TMDB key, then Prowlarr, when the server has neither', () => {
    expect(setupSteps({ ...SET, tmdb: { configured: false, source: null, fallback: null }, prowlarr: noProwlarr })).toEqual(['tmdb', 'prowlarr'])
    expect(setupSteps({ ...SET, prowlarr: noProwlarr })).toEqual(['prowlarr'])
  })

  it.each([
    ['Kinopeer’s own login is off', { enabled: false } as const],
    ['the server is older and says nothing of it', undefined],
  ])('asks nothing of Prowlarr when %s, since the server wouldn’t save an address', (_name, auth) => {
    expect(setupSteps({ ...SET, prowlarr: noProwlarr, auth })).toEqual([])
  })
})

describe('useSetupSteps', () => {
  const settings = vi.mocked(getSharedServerSettings)
  beforeEach(() => settings.mockReset())

  it('asks the server only once qBittorrent is connected, then goes through the steps', async () => {
    settings.mockResolvedValue({ ...SET, prowlarr: noProwlarr })
    const { result, rerender } = renderHook(({ enabled }) => useSetupSteps(enabled), { initialProps: { enabled: false } })
    expect(settings).not.toHaveBeenCalled()
    expect(result.current.step).toBe('checking')

    rerender({ enabled: true })
    await vi.waitFor(() => expect(result.current.step).toBe('prowlarr'))
    act(() => result.current.finish('prowlarr'))
    expect(result.current.step).toBe('done')
  })

  it('keeps a skipped step skipped for the page when qBittorrent connects again', async () => {
    settings.mockResolvedValue({ ...SET, prowlarr: noProwlarr })
    const { result, rerender } = renderHook(({ enabled }) => useSetupSteps(enabled), { initialProps: { enabled: true } })
    await vi.waitFor(() => expect(result.current.step).toBe('prowlarr'))
    act(() => result.current.finish('prowlarr'))

    // A session lost and found again (a recheck after a 403, Retry) asks the server nothing more.
    rerender({ enabled: false })
    rerender({ enabled: true })
    await act(() => Promise.resolve())
    expect(result.current.step).toBe('done')
    expect(settings).toHaveBeenCalledOnce()
  })

  it('drops an answer that comes after qBittorrent disconnected', async () => {
    let answer: (settings: ServerSettings) => void = () => {}
    settings.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result, rerender } = renderHook(({ enabled }) => useSetupSteps(enabled), { initialProps: { enabled: true } })
    rerender({ enabled: false })
    await act(async () => answer({ ...SET, prowlarr: noProwlarr }))
    expect(result.current.step).toBe('checking')
  })
})
