import { describe, expect, it } from 'vitest'
import { torrent } from '../test/fixtures'
import { notifies, withNotify } from './notify'

describe('notifies', () => {
  it.each([
    ['', false],
    ['kinopeer:notify', true],
    ['tmdb:movie:1, kinopeer:notify', true],
    ['kinopeer:notify-later, kinopeer', false],
  ])('%j: %s', (tags, on) => {
    expect(notifies({ tags })).toBe(on)
  })
})

describe('withNotify', () => {
  it('adds the tag among the others, sorted as qBittorrent lists them', () => {
    expect(withNotify(torrent('a', { tags: 'tmdb:movie:1' }), true).tags).toBe('kinopeer:notify, tmdb:movie:1')
    expect(withNotify(torrent('a', { tags: '' }), true).tags).toBe('kinopeer:notify')
  })

  it('takes only the tag off', () => {
    expect(withNotify(torrent('a', { tags: 'kinopeer:notify, tmdb:movie:1' }), false).tags).toBe('tmdb:movie:1')
  })

  it('keeps a single tag when it’s there already', () => {
    expect(withNotify(torrent('a', { tags: 'kinopeer:notify' }), true).tags).toBe('kinopeer:notify')
  })
})
