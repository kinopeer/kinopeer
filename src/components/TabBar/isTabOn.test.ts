import { describe, expect, it } from 'vitest'
import { isTabOn } from './isTabOn'
import type { TabBarItem } from './TabBar'

const downloads: TabBarItem = { to: '/', icon: 'download', label: 'Downloads', also: ['/torrent/'] }
const search: TabBarItem = { to: '/search', icon: 'search', label: 'Search' }

describe('isTabOn', () => {
  it('is on for the tab’s own route', () => {
    expect(isTabOn(downloads, true, '/')).toBe(true)
    expect(isTabOn(search, false, '/')).toBe(false)
  })

  it('is on for the screens inside the tab, by path prefix', () => {
    expect(isTabOn(downloads, false, '/torrent/abc')).toBe(true)
    expect(isTabOn(downloads, false, '/torrents')).toBe(false)
    expect(isTabOn(search, false, '/torrent/abc')).toBe(false)
  })
})
