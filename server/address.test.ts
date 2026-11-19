import { describe, expect, it } from 'vitest'
import { baseOf, parseAddress } from './address.ts'

describe('baseOf', () => {
  it('trims an address and drops its trailing slashes, and has none for a blank one', () => {
    expect(baseOf(' http://qbt.test:8080// ')).toBe('http://qbt.test:8080')
    expect(baseOf('http://qbt.test/sub/')).toBe('http://qbt.test/sub')
    expect(baseOf('  ')).toBeUndefined()
    expect(baseOf(undefined)).toBeUndefined()
  })
})

describe('parseAddress', () => {
  it('takes an http or https address as the server will call it, its path kept', () => {
    expect(parseAddress(' http://192.168.1.10:8080/ ')).toBe('http://192.168.1.10:8080')
    expect(parseAddress('https://qbt.example.com/qbittorrent/')).toBe('https://qbt.example.com/qbittorrent')
    expect(parseAddress('HTTP://Prowlarr.Local:9696')).toBe('http://prowlarr.local:9696')
    // A lone ? or # names nothing, so the address is the same without it.
    expect(parseAddress('http://qbt.test:8080/?')).toBe('http://qbt.test:8080')
    expect(parseAddress('http://qbt.test:8080/#')).toBe('http://qbt.test:8080')
  })

  it.each([
    ['not a string', 8080],
    ['blank', ' '],
    ['no scheme', '192.168.1.10:8080'],
    ['not http', 'ftp://qbt.test'],
    ['a script', 'javascript:alert(1)'],
    ['a file', 'file:///etc/passwd'],
    ['a login in it', 'http://admin:secret@qbt.test:8080'],
    ['a user in it', 'http://admin@qbt.test:8080'],
    ['a query', 'http://qbt.test:8080/?a=1'],
    ['a fragment', 'http://qbt.test:8080/#top'],
    ['too long', `http://qbt.test/${'a'.repeat(2048)}`],
  ])('refuses an address with %s', (_, value) => {
    expect(parseAddress(value)).toBeUndefined()
  })

  it('takes an address of 2048 characters', () => {
    const address = `http://qbt.test/${'a'.repeat(2048 - 'http://qbt.test/'.length)}`
    expect(parseAddress(address)).toBe(address)
  })
})
