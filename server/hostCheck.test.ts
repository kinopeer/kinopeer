import { afterEach, describe, expect, it } from 'vitest'
import { allowedHosts, allowedHostsWarning, hostCheck, hostName, isAllowedHost, isPrivateHost, refusal, refusedHost } from './hostCheck.ts'
import { closeServers, getWithHost, serve } from './test/fakes.ts'

afterEach(closeServers)

/** Only the defaults: nothing in KINOPEER_ALLOWED_HOSTS. */
const DEFAULTS = allowedHosts(undefined).allowed

describe('hostName', () => {
  it('reads a Host header as browsers name the host, without its port or trailing dot', () => {
    expect(hostName('Umbrel.Local:8797')).toBe('umbrel.local')
    expect(hostName('umbrel.local.')).toBe('umbrel.local')
    expect(hostName('[::1]:8080')).toBe('[::1]')
    expect(hostName('кино.example.com')).toBe('xn--h1adke.example.com')
    expect(hostName('0x7f.1')).toBe('127.0.0.1')
  })

  it('reads nothing from what isn’t a host alone', () => {
    for (const value of ['', 'a b', 'evil.example/x', 'user@nas', 'nas?x', 'nas#x', 'https://kinopeer.example.com', 'nas:port'])
      expect(hostName(value), value).toBeUndefined()
  })
})

describe('isPrivateHost', () => {
  it('takes addresses and the names public DNS doesn’t answer for', () => {
    for (const name of [
      '192.168.1.10',
      '10.0.10.200',
      '127.0.0.1',
      '[::1]',
      '[fd00::1]',
      'localhost',
      'kinopeer.localhost',
      'umbrel.local',
      'abcdefghijklmnop.onion',
      'nas.home.arpa',
      'kinopeer.internal',
      // One label: a LAN name, a Docker service or container.
      'nas',
      'homelab-kinopeer_web_1',
    ])
      expect(isPrivateHost(name), name).toBe(true)
  })

  it('refuses a name anyone can register, a private suffix’s look-alikes included', () => {
    for (const name of ['evil.example', 'local.evil.example', 'fritz.box', 'nas.lan', 'evil.onion.example', 'notlocalhost.example'])
      expect(isPrivateHost(name), name).toBe(false)
    // An address's look-alike is a name like any other.
    expect(isPrivateHost('192.168.1.10.rebound.example')).toBe(false)
    // A suffix counts only as a whole label.
    expect(isPrivateHost('evil.notlocal')).toBe(false)
    expect(isPrivateHost('xonion.example')).toBe(false)
  })
})

describe('allowedHosts', () => {
  it('reads names and domains separated by commas or spaces', () => {
    expect(allowedHosts(' kinopeer.example.com, .home.example.org  *.vpn.example.net\nKINO.example.com:443 ')).toEqual({
      allowed: {
        any: false,
        names: ['kinopeer.example.com', 'kino.example.com'],
        domains: ['.home.example.org', '.vpn.example.net'],
      },
      invalid: [],
      tooBroad: [],
    })
  })

  it('takes * as any host', () => {
    expect(allowedHosts('*').allowed.any).toBe(true)
    expect(allowedHosts('kinopeer.example.com,*').allowed.any).toBe(true)
    expect(allowedHosts('').allowed.any).toBe(false)
  })

  it('sets aside what isn’t a host name, and a domain of one label, to warn about', () => {
    expect(allowedHosts('https://kinopeer.example.com, kinopeer.example.com/x, *kino.example.com, *., ..example.com, .lan, *.com, ok.example.com')).toEqual({
      allowed: { any: false, names: ['ok.example.com'], domains: [] },
      invalid: ['https://kinopeer.example.com', 'kinopeer.example.com/x', '*kino.example.com', '*.', '..example.com'],
      tooBroad: ['.lan', '*.com'],
    })
  })
})

describe('allowedHostsWarning', () => {
  it('names the entries ignored and why, and says nothing without any', () => {
    expect(allowedHostsWarning('https://kinopeer.example.com, ok.example.com, kino.example.com/x')).toBe(
      'KINOPEER_ALLOWED_HOSTS: not host names, ignored: https://kinopeer.example.com, kino.example.com/x',
    )
    expect(allowedHostsWarning('.lan, ok.example.com')).toBe(
      'KINOPEER_ALLOWED_HOSTS: domains of one label are too broad, ignored: .lan (list its names instead, such as kinopeer.lan)',
    )
    // A private suffix's names need no listing.
    expect(allowedHostsWarning('.local, *.Internal')).toBe(
      'KINOPEER_ALLOWED_HOSTS: domains of one label are too broad, ignored: .local (its names are allowed already), *.Internal (its names are allowed already)',
    )
    expect(allowedHostsWarning('https://kinopeer.example.com, *.com')).toBe(
      'KINOPEER_ALLOWED_HOSTS: not host names, ignored: https://kinopeer.example.com; domains of one label are too broad, ignored: *.com (list its names instead, such as kinopeer.com)',
    )
    expect(allowedHostsWarning('ok.example.com')).toBeUndefined()
    expect(allowedHostsWarning(undefined)).toBeUndefined()
  })
})

describe('isAllowedHost', () => {
  it('answers at a private name by default, and at no other', () => {
    expect(isAllowedHost('192.168.1.10:8797', DEFAULTS)).toBe(true)
    expect(isAllowedHost('umbrel.local:8797', DEFAULTS)).toBe(true)
    expect(isAllowedHost('rebound.example:8797', DEFAULTS)).toBe(false)
  })

  it('answers at nothing without a host or with one it can’t read', () => {
    expect(isAllowedHost(undefined, DEFAULTS)).toBe(false)
    expect(isAllowedHost('', DEFAULTS)).toBe(false)
    expect(isAllowedHost('nas/x', DEFAULTS)).toBe(false)
  })

  it('adds the names and domains KINOPEER_ALLOWED_HOSTS gives', () => {
    const { allowed } = allowedHosts('kinopeer.example.com .home.example.org')

    expect(isAllowedHost('Kinopeer.Example.com:443', allowed)).toBe(true)
    expect(isAllowedHost('home.example.org', allowed)).toBe(true)
    expect(isAllowedHost('nas.home.example.org', allowed)).toBe(true)
    // Still the defaults.
    expect(isAllowedHost('umbrel.local', allowed)).toBe(true)
    // A name is the name alone, and a domain's look-alike isn't under it.
    expect(isAllowedHost('sub.kinopeer.example.com', allowed)).toBe(false)
    expect(isAllowedHost('evilhome.example.org', allowed)).toBe(false)
  })

  it('answers at any host with *, even without one', () => {
    const { allowed } = allowedHosts('*')

    expect(isAllowedHost('rebound.example', allowed)).toBe(true)
    expect(isAllowedHost(undefined, allowed)).toBe(true)
  })
})

describe('refusedHost', () => {
  it('names nothing when Host and every forwarded host are allowed', () => {
    expect(refusedHost({ host: 'umbrel.local' }, DEFAULTS)).toBeUndefined()
    expect(refusedHost({ host: 'kinopeer:8080', 'x-forwarded-host': 'umbrel.local, 192.168.1.10' }, DEFAULTS)).toBeUndefined()
  })

  it('names a Host not allowed, or an empty one for none', () => {
    expect(refusedHost({ host: 'rebound.example' }, DEFAULTS)).toBe('rebound.example')
    expect(refusedHost({}, DEFAULTS)).toBe('')
  })

  it('names a forwarded host not allowed behind a proxy that sends its own Host', () => {
    // nginx sends its upstream's address as Host unless told otherwise.
    expect(refusedHost({ host: 'kinopeer:8080', 'x-forwarded-host': 'rebound.example' }, DEFAULTS)).toBe('rebound.example')
    expect(refusedHost({ host: 'kinopeer:8080', 'x-forwarded-host': 'umbrel.local, rebound.example' }, DEFAULTS)).toBe('rebound.example')
  })

  it('takes an empty forwarded host for none', () => {
    expect(refusedHost({ host: 'umbrel.local', 'x-forwarded-host': '' }, DEFAULTS)).toBeUndefined()
  })

  it('lets no forwarded host through a Host not allowed', () => {
    expect(refusedHost({ host: 'rebound.example', 'x-forwarded-host': 'localhost' }, DEFAULTS)).toBe('rebound.example')
  })
})

describe('hostCheck', () => {
  it('hands an allowed request on', async () => {
    const app = await serve(hostCheck(DEFAULTS))

    const response = await getWithHost(app, '/anything', { host: 'umbrel.local:8797' })

    // The route after it answered.
    expect(response.body).toBe('fallback')
  })

  it('refuses another host with a text that says what to set', async () => {
    const app = await serve(hostCheck(DEFAULTS))

    const response = await getWithHost(app, '/qbt/api/v2/app/version', { host: 'Kinopeer.Example.com:8443' })

    expect(response.status).toBe(403)
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toBe(refusal('kinopeer.example.com'))
    expect(response.body).toContain("Kinopeer doesn't answer at kinopeer.example.com.")
    expect(response.body).toContain('KINOPEER_ALLOWED_HOSTS=kinopeer.example.com')
  })
})

describe('hostCheck, a host it can’t read', () => {
  it('says what to set rather than echo a value the variable can’t take', async () => {
    const app = await serve(hostCheck(DEFAULTS))

    const response = await getWithHost(app, '/', { host: 'umbrel.local', 'x-forwarded-host': 'kino.example.com/x' })

    expect(response.status).toBe(403)
    expect(response.body).toBe(refusal(''))
  })
})

describe('refusal', () => {
  it('says what to set for a request without a host name it can read', () => {
    // For a host hostName can't read, and an HTTP/1.0 request without Host (Node's server refuses
    // an HTTP/1.1 one before any route).
    const text = refusal('')

    expect(text).toContain("Kinopeer doesn't answer a request without a host name it can read.")
    expect(text).toContain('KINOPEER_ALLOWED_HOSTS=kinopeer.example.com')
  })
})
