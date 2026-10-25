import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { digest, sha1, sha256, toHex } from './digest'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('sha1 and sha256', () => {
  it('match the known vectors', () => {
    expect(toHex(sha1(utf8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(toHex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(toHex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(toHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  // Lengths around the 64-byte block and its 9 bytes of padding, and a few blocks.
  it.each([0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_001])('match Node for %i random bytes', (length) => {
    const bytes = new Uint8Array(randomBytes(length))
    expect(toHex(sha1(bytes))).toBe(createHash('sha1').update(bytes).digest('hex'))
    expect(toHex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('hash a view into a larger buffer', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const view = buffer.subarray(2, 6)
    expect(toHex(sha1(view))).toBe(createHash('sha1').update(view).digest('hex'))
  })
})

describe('digest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses Web Crypto when the page has it', async () => {
    const spy = vi.spyOn(crypto.subtle, 'digest')
    expect(toHex(await digest('SHA-256', utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(spy).toHaveBeenCalledWith('SHA-256', expect.anything())
  })

  it('falls back to the plain implementation over plain HTTP, where crypto.subtle is missing', async () => {
    vi.stubGlobal('crypto', {})
    expect(toHex(await digest('SHA-1', utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(toHex(await digest('SHA-256', utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
