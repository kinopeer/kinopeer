import type { Location } from 'react-router'
import { describe, expect, it } from 'vitest'
import { backgroundOf, overPage } from './background'

const title: Location = { pathname: '/title/movie/1', search: '', hash: '', state: null, key: 'a' }

describe('background location', () => {
  it('carries the page a link opens the drawer over', () => {
    const torrent: Location = { pathname: '/torrent/x', search: '', hash: '', state: overPage(title), key: 'b' }
    expect(backgroundOf(torrent)).toBe(title)
  })

  it('has none without it in the state', () => {
    expect(backgroundOf(title)).toBeUndefined()
    expect(backgroundOf({ ...title, state: { added: 'Dune' } })).toBeUndefined()
  })
})
