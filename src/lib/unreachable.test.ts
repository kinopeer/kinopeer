import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { controlledByServiceWorker } from '../test/render'
import { unreachableText, useMayOpenAgain } from './unreachable'

describe('unreachableText', () => {
  it('names Kinopeer whether nothing answered for its server or something else did, and qBittorrent otherwise', () => {
    expect(unreachableText('unreached')).toBe('kinopeer')
    expect(unreachableText('kinopeer')).toBe('kinopeer')
    expect(unreachableText('qbittorrent')).toBeUndefined()
    expect(unreachableText(undefined)).toBeUndefined()
  })
})

describe('useMayOpenAgain', () => {
  it('offers Open again only when nothing answered for Kinopeer’s server', () => {
    controlledByServiceWorker()
    expect(renderHook(() => useMayOpenAgain('unreached')).result.current).toBe(true)
    expect(renderHook(() => useMayOpenAgain('kinopeer')).result.current).toBe(false)
    expect(renderHook(() => useMayOpenAgain('qbittorrent')).result.current).toBe(false)
    expect(renderHook(() => useMayOpenAgain(undefined)).result.current).toBe(false)
  })

  it('takes it back while the device is offline, where a page load would end on the browser’s error page, and offers it again online', () => {
    controlledByServiceWorker()
    const onLine = vi.spyOn(navigator, 'onLine', 'get')
    const { result } = renderHook(() => useMayOpenAgain('unreached'))
    onLine.mockReturnValue(false)
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)
    onLine.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
  })

  it('doesn’t offer it without a service worker (plain HTTP), where every page load goes to the network already', () => {
    expect(renderHook(() => useMayOpenAgain('unreached')).result.current).toBe(false)
  })

  it('offers it once a service worker takes the page, as after the first install', () => {
    const container = controlledByServiceWorker(null)
    const { result } = renderHook(() => useMayOpenAgain('unreached'))
    expect(result.current).toBe(false)
    container.controller = {}
    act(() => void container.dispatchEvent(new Event('controllerchange')))
    expect(result.current).toBe(true)
  })

  it('stops following the device and the worker once nothing uses it, removing the very listeners it added', () => {
    const container = controlledByServiceWorker()
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const addedToWorker = vi.spyOn(container, 'addEventListener')
    const removedFromWorker = vi.spyOn(container, 'removeEventListener')
    renderHook(() => useMayOpenAgain('unreached')).unmount()
    const listener = (spy: typeof added, type: string) => spy.mock.calls.find(([name]) => name === type)?.[1]
    expect(listener(added, 'online')).toBeDefined()
    expect(removed).toHaveBeenCalledWith('online', listener(added, 'online'))
    expect(removed).toHaveBeenCalledWith('offline', listener(added, 'offline'))
    expect(removedFromWorker).toHaveBeenCalledWith('controllerchange', addedToWorker.mock.calls[0][1])
  })
})
