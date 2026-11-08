import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('offers Open again only when nothing answered for Kinopeer’s server and the device is online', () => {
    expect(renderHook(() => useMayOpenAgain('unreached')).result.current).toBe(true)
    expect(renderHook(() => useMayOpenAgain('kinopeer')).result.current).toBe(false)
    expect(renderHook(() => useMayOpenAgain('qbittorrent')).result.current).toBe(false)
    expect(renderHook(() => useMayOpenAgain(undefined)).result.current).toBe(false)
  })

  it('takes it back while the device is offline, where a page load would end on the browser’s error page, and offers it again online', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get')
    const { result } = renderHook(() => useMayOpenAgain('unreached'))
    onLine.mockReturnValue(false)
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)
    onLine.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
  })
})
