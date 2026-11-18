import { describe, expect, it } from 'vitest'
import { torrentId } from './sameTorrent'

const V1 = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
const V2 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('torrentId', () => {
  it.each([
    ['a v1 hash as it is', V1, V1],
    ['a v1 hash in capitals, lowercased', V1.toUpperCase(), V1],
    ['a v2 hash truncated to 40 digits', V2, V2.slice(0, 40)],
    ['a hash with spaces around it, trimmed', ` ${V1} `, V1],
  ])('takes %s', (_, hash, id) => {
    expect(torrentId(hash)).toBe(id)
  })

  it.each([
    ['no hash', undefined],
    ['nothing', ''],
    ['a hash too short', V1.slice(1)],
    ['one between v1 and v2', `${V1}abcd`],
    ['one too long', `${V2}0`],
    ['a base32 hash', 'YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK'],
    ['not hex', 'g'.repeat(40)],
  ])('refuses %s', (_, hash) => {
    expect(torrentId(hash)).toBeUndefined()
  })
})
