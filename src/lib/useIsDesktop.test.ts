import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubDesktop } from './stubDesktop'
import { useIsDesktop } from './useIsDesktop'

describe('useIsDesktop', () => {
  it('is false without matchMedia', () => {
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
  })

  it('follows the desktop media query as the window is resized', () => {
    const resize = stubDesktop(false)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)

    act(() => resize(true))
    expect(result.current).toBe(true)

    act(() => resize(false))
    expect(result.current).toBe(false)
  })
})
