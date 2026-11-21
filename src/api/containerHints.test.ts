import { describe, expect, it } from 'vitest'
import { isContainerHint, isSourceAddress, parseSource } from './containerHints'

describe('isSourceAddress', () => {
  it('takes an IPv4 address and a subnet in CIDR', () => {
    expect(isSourceAddress({ address: '172.18.0.5', subnet: '172.18.0.0/16' })).toBe(true)
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', '172.18.0.5'],
    ['no subnet', { address: '172.18.0.5' }],
    ['a subnet without its prefix', { address: '172.18.0.5', subnet: '172.18.0.0' }],
    ['an address that isn’t one', { address: '<b>x</b>', subnet: '172.18.0.0/16' }],
    ['a number for the address', { address: 1, subnet: '172.18.0.0/16' }],
  ])('refuses %s', (_, value) => {
    expect(isSourceAddress(value)).toBe(false)
  })
})

describe('isContainerHint', () => {
  it('takes one with the host’s address, or without one', () => {
    expect(isContainerHint({ hostAddress: 'http://host.docker.internal:8080' })).toBe(true)
    expect(isContainerHint({})).toBe(true)
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an address that isn’t http', { hostAddress: 'javascript:alert(1)' }],
    ['an address with a space', { hostAddress: 'http://host docker' }],
    ['a number', { hostAddress: 8080 }],
  ])('refuses %s', (_, value) => {
    expect(isContainerHint(value)).toBe(false)
  })
})

describe('parseSource', () => {
  it('reads the address and the subnet', () => {
    expect(parseSource('172.18.0.5 172.18.0.0/16')).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
  })

  it.each([null, '', '172.18.0.5', '172.18.0.5 172.18.0.0/16 more', 'a b'])('reads nothing from %j', (header) => {
    expect(parseSource(header)).toBeUndefined()
  })
})
