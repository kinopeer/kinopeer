import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAB_RETURN, forgetTabPlaces, isTabReturn, saveTabPlace, tabPlace, useTabSearch } from './tabPlaces'

beforeEach(() => {
  sessionStorage.clear()
  forgetTabPlaces()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('tab places', () => {
  it('keeps where each tab was left, apart', () => {
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    saveTabPlace('/', { search: '', y: 120 })
    expect(tabPlace('/search')).toEqual({ search: '?q=dune', y: 640 })
    expect(tabPlace('/')).toEqual({ search: '', y: 120 })
    expect(tabPlace('/settings')).toBeUndefined()
  })

  it('keeps them across a reload, in the session’s storage', async () => {
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    vi.resetModules()
    const reloaded = await import('./tabPlaces')
    expect(reloaded.tabPlace('/search')).toEqual({ search: '?q=dune', y: 640 })
  })

  it('leaves out what it stored in another shape, and storage it can’t read', async () => {
    sessionStorage.setItem(
      'kinopeer.tabs',
      JSON.stringify({ '/': { search: '', y: 120 }, '/search': { search: '?q=dune', y: '640' }, '/settings': { y: 80 }, '/x': null }),
    )
    expect(tabPlace('/')).toEqual({ search: '', y: 120 })
    expect(tabPlace('/search')).toBeUndefined()
    expect(tabPlace('/settings')).toBeUndefined()
    expect(tabPlace('/x')).toBeUndefined()

    for (const stored of ['{not json', '42', 'null', '"/search"']) {
      sessionStorage.setItem('kinopeer.tabs', stored)
      vi.resetModules()
      const reloaded = await import('./tabPlaces')
      expect(reloaded.tabPlace('/')).toBeUndefined()
      // And it still keeps a new one.
      reloaded.saveTabPlace('/', { search: '', y: 80 })
      expect(reloaded.tabPlace('/')).toEqual({ search: '', y: 80 })
    }
  })

  it('forgets them all, in storage too', async () => {
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    forgetTabPlaces()
    expect(tabPlace('/search')).toBeUndefined()
    vi.resetModules()
    const reloaded = await import('./tabPlaces')
    expect(reloaded.tabPlace('/search')).toBeUndefined()
  })

  it('keeps them for the page when the storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    saveTabPlace('/search', { search: '?q=dune', y: 640 })
    expect(tabPlace('/search')).toEqual({ search: '?q=dune', y: 640 })
  })

  it('gives a tab’s link the query the tab was left with, as it changes', () => {
    const { result } = renderHook(() => useTabSearch('/search'))
    expect(result.current).toBe('')
    act(() => saveTabPlace('/search', { search: '?q=dune&type=tv', y: 0 }))
    expect(result.current).toBe('?q=dune&type=tv')
  })

  it('tells a tab’s link from another navigation by its state', () => {
    expect(isTabReturn(TAB_RETURN)).toBe(true)
    expect(isTabReturn(null)).toBe(false)
    expect(isTabReturn({ added: 'Dune' })).toBe(false)
    expect(isTabReturn({ tabReturn: 'yes' })).toBe(false)
  })
})
