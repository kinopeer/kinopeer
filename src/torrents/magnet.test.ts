import { describe, expect, it } from 'vitest'
import { parseMagnet } from './magnet'

describe('parseMagnet', () => {
  it('reads a hex v1 hash and the display name', () => {
    expect(
      parseMagnet('magnet:?xt=urn:btih:C9E15763F722F23E98A29DECDFAE341B98D53056&dn=Dune.2021.1080p&tr=udp%3A%2F%2Ftracker'),
    ).toEqual({ infoHash: 'c9e15763f722f23e98a29decdfae341b98d53056', name: 'Dune.2021.1080p' })
  })

  it('converts a base32 v1 hash to hex', () => {
    expect(parseMagnet('magnet:?xt=urn:btih:ZHQVOY7XELZD5GFCTXWN7LRUDOMNKMCW')?.infoHash).toBe(
      'c9e15763f722f23e98a29decdfae341b98d53056',
    )
  })

  it('truncates a v2 hash when there is no v1 one', () => {
    const digest = 'ab'.repeat(32)
    expect(parseMagnet(`magnet:?xt=urn:btmh:1220${digest}`)?.infoHash).toBe('ab'.repeat(20))
  })

  it('rejects anything else', () => {
    expect(parseMagnet('https://kinozal.me/details.php?id=1')).toBeUndefined()
    expect(parseMagnet('magnet:?dn=no-hash')).toBeUndefined()
    expect(parseMagnet('magnet:?xt=urn:btih:nothex')).toBeUndefined()
  })
})
