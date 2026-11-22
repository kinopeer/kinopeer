import { describe, expect, it } from 'vitest'
import { isPrivateOrigin } from './privateOrigin'

describe('isPrivateOrigin', () => {
  it.each([
    ['a 10/8 address', 'http://10.0.0.5:8080'],
    ['a 172.16/12 address, at its start', 'http://172.16.0.1'],
    ['a 172.16/12 address, at its end', 'http://172.31.255.254'],
    ['a 192.168/16 address', 'https://192.168.1.20:8443'],
    ['a loopback address', 'http://127.0.0.1:8080'],
    ['a loopback address in another form', 'http://0x7f.1'],
    ['a link-local address', 'http://169.254.10.1'],
    ['a CGNAT address, at its start', 'http://100.64.0.1'],
    ['a CGNAT address, at its end', 'http://100.127.255.254'],
    ['IPv6 loopback', 'http://[::1]:8080'],
    ['an IPv6 unique local address (fc00::/7), fd', 'http://[fd12:3456::1]'],
    ['an IPv6 unique local address (fc00::/7), fc', 'http://[fc00::1]'],
    ['an IPv6 unique local address with its zeros elided at the end', 'http://[fd00::]'],
    ['an IPv6 link-local address, at the start of fe80::/10', 'http://[fe80::1]'],
    ['an IPv6 link-local address, at the end of fe80::/10', 'http://[febf::1]'],
    ['localhost', 'http://localhost:8080'],
    ['a name under .localhost', 'http://kinopeer.localhost'],
    ['a name under .local', 'http://umbrel.local'],
    ['a name under .local, in capitals', 'http://Umbrel.LOCAL'],
    ['a name under .home.arpa', 'http://nas.home.arpa:8080'],
    ['a name under .internal', 'https://qbt.internal'],
    ['a name of one label', 'http://nas:8080'],
    ['a fully qualified name with its trailing dot', 'http://umbrel.local.'],
  ])('reads %s as private', (_, origin) => {
    expect(isPrivateOrigin(origin)).toBe(true)
  })

  it.each([
    ['a public name', 'https://example.com'],
    ['a public IPv4 address', 'http://203.0.113.7'],
    ['an address just below 172.16/12', 'http://172.15.255.255'],
    ['an address just above 172.16/12', 'http://172.32.0.1'],
    ['an address just below CGNAT', 'http://100.63.255.255'],
    ['an address just above CGNAT', 'http://100.128.0.1'],
    ['192.169/16', 'http://192.169.0.1'],
    // The second number of a private range, after another first number.
    ['8.16/16, the second number of 172.16/12', 'http://8.16.0.1'],
    ['8.168/16, the second number of 192.168/16', 'http://8.168.0.1'],
    ['8.254/16, the second number of 169.254/16', 'http://8.254.0.1'],
    ['8.64/16, the second number of 100.64/10', 'http://8.64.0.1'],
    ['a public name that starts like a private address', 'http://10.0.0.1.example.com'],
    ['169.253/16', 'http://169.253.0.1'],
    ['a public IPv6 address', 'http://[2001:db8::1]'],
    ['an IPv6 address just below fc00::/7', 'http://[fbff::1]'],
    ['an IPv6 address just above fe80::/10', 'http://[fec0::1]'],
    ['the IPv6 unspecified address', 'http://[::]'],
    ['a name that only ends like .local', 'http://evil-local.com'],
    ['a public name with .local inside it', 'http://umbrel.local.example.com'],
    ['a name whose last label ends in "local"', 'http://example.nonlocal'],
    ['the opaque origin of a sandboxed page or a file', 'null'],
    ['an origin that isn’t http(s)', 'chrome-extension://abcdef'],
    ['no origin', null],
    ['an empty origin', ''],
    ['an origin of a lone dot', 'http://.'],
  ])('reads %s as public', (_, origin) => {
    expect(isPrivateOrigin(origin)).toBe(false)
  })
})
