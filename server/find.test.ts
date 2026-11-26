import { getEventListeners } from 'node:events'
import { createServer, isIPv4, type LookupFunction } from 'node:net'
import type { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_SUBNETS,
  PARALLEL,
  USUAL,
  candidateHosts,
  isPrivate,
  findService,
  identifies,
  opens,
  pooled,
  subnetHosts,
  systemOnDisk,
  type FindSystem,
} from './find.ts'
import { CLOSED_ADDRESS, closeServers, fakeProwlarr, fakeQbittorrent, listen, settlesWithin } from './test/fakes.ts'

afterEach(async () => {
  await closeServers()
})

type Interfaces = ReturnType<typeof networkInterfaces>

/** An interface entry as os.networkInterfaces() gives it. */
function v4(address: string, cidr: string, internal = false) {
  return { address, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '02:42:ac:12:00:05', internal, cidr }
}

/** A server on a Docker network (172.18.0.5/16) and a LAN (192.168.1.5/24), with loopback and IPv6. */
const INTERFACES = {
  lo: [v4('127.0.0.1', '127.0.0.1/8', true)],
  eth0: [
    v4('172.18.0.5', '172.18.0.5/16'),
    { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '02:42:ac:12:00:05', internal: false, cidr: 'fe80::1/64', scopeid: 2 },
  ],
  wlan0: [v4('192.168.1.5', '192.168.1.5/24')],
} as Interfaces

describe('subnetHosts', () => {
  it('lists each own network’s /24 around the server’s address, but the server’s own and loopback', () => {
    const hosts = subnetHosts(INTERFACES)
    expect(hosts).toHaveLength(2 * 253)
    expect(hosts.slice(0, 5)).toEqual(['172.18.0.1', '172.18.0.2', '172.18.0.3', '172.18.0.4', '172.18.0.6'])
    expect(hosts).toContain('172.18.0.254')
    expect(hosts).toContain('192.168.1.1')
    expect(hosts).not.toContain('172.18.0.0')
    expect(hosts).not.toContain('172.18.0.255')
    expect(hosts).not.toContain('172.18.0.5')
    expect(hosts).not.toContain('192.168.1.5')
    expect(hosts.some((host) => host.startsWith('127.'))).toBe(false)
  })

  it('scans a /24 once for two addresses in it, and at most MAX_SUBNETS of them', () => {
    expect(subnetHosts({ eth0: [v4('10.0.0.5', '10.0.0.5/24'), v4('10.0.0.6', '10.0.0.6/24')] } as Interfaces)).toHaveLength(252)
    const many = Object.fromEntries(Array.from({ length: MAX_SUBNETS + 2 }, (_, i) => [`eth${i}`, [v4(`10.0.${i}.5`, `10.0.${i}.5/24`)]])) as Interfaces
    const prefixes = new Set(subnetHosts(many).map((host) => host.split('.').slice(0, 3).join('.')))
    expect([...prefixes]).toEqual(Array.from({ length: MAX_SUBNETS }, (_, i) => `10.0.${i}`))
  })

  it('scans nothing without a network of its own', () => {
    expect(subnetHosts({ lo: [v4('127.0.0.1', '127.0.0.1/8', true)] } as Interfaces)).toEqual([])
  })

  it('scans no public address’s /24, a provider’s other customers, beside a private one', () => {
    const hosts = subnetHosts({ eth0: [v4('203.0.113.5', '203.0.113.5/24')], wg0: [v4('10.8.0.2', '10.8.0.2/24')] } as Interfaces)
    expect(hosts).toHaveLength(253)
    expect(hosts.every((host) => host.startsWith('10.8.0.'))).toBe(true)
  })

  it('scans around no private alias on loopback, yet leaves it out as the server’s own', () => {
    const lo = [v4('127.0.0.1', '127.0.0.1/8', true), v4('10.254.254.254', '10.254.254.254/32', true), v4('10.0.0.9', '10.0.0.9/32', true)]
    const hosts = subnetHosts({ lo, eth0: [v4('10.0.0.5', '10.0.0.5/24')] } as Interfaces)
    expect(hosts).toHaveLength(252)
    expect(hosts.every((host) => host.startsWith('10.0.0.'))).toBe(true)
    expect(hosts).not.toContain('10.0.0.9')
  })
})

describe('isPrivate', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.254', true],
    ['192.168.1.10', true],
    ['100.64.0.1', true],
    ['100.127.255.254', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.167.1.1', false],
    ['100.63.0.1', false],
    ['100.128.0.1', false],
    ['11.0.0.1', false],
    ['11.20.0.1', false],
    ['193.168.0.1', false],
    ['101.100.0.1', false],
    ['203.0.113.5', false],
  ])('%s is private: %s', (address, expected) => {
    expect(isPrivate(address)).toBe(expected)
  })
})

describe('candidateHosts', () => {
  it('tries the usual names, then the host, then the subnets, each once', () => {
    const hosts = candidateHosts('qbittorrent', ['host.docker.internal', '172.18.0.1'], { eth0: [v4('172.18.0.5', '172.18.0.5/16')] } as Interfaces)
    expect(hosts.slice(0, 6)).toEqual(['qbittorrent', 'qbittorrentvpn', 'gluetun', 'host.docker.internal', '172.18.0.1', '172.18.0.2'])
    expect(new Set(hosts).size).toBe(hosts.length)
    expect(candidateHosts('prowlarr', ['localhost'], {})).toEqual(['prowlarr', 'localhost'])
  })
})

describe('pooled', () => {
  it('runs at most `limit` tasks at once and keeps the items’ order', async () => {
    let running = 0
    let most = 0
    // Each task takes that many turns of the microtask queue, so they end in another order.
    const results = await pooled([5, 1, 4, 2, 3], 2, async (turns) => {
      most = Math.max(most, ++running)
      for (let turn = 0; turn < turns; turn++) await null
      running--
      return turns * 10
    })
    expect(results).toEqual([50, 10, 40, 20, 30])
    expect(most).toBe(2)
  })
})

describe('findService', () => {
  /** A system whose hosts take a connection where `open` says, and answer as the service where `service` says. */
  function system({ open = [] as string[], service = [] as string[], names = {} as Record<string, string>, interfaces = {} as Interfaces } = {}) {
    const tried: string[] = []
    let running = 0
    const fake: FindSystem & { tried: string[]; most: number } = {
      tried,
      most: 0,
      interfaces: () => interfaces,
      // As a lookup does, an address resolves to itself.
      resolve: async (host) => names[host] ?? (isIPv4(host) ? host : undefined),
      opens: async (host, port) => {
        tried.push(`${host}:${port}`)
        fake.most = Math.max(fake.most, ++running)
        await null
        running--
        return open.includes(`${host}:${port}`)
      },
      identifies: async (_service, base) => service.includes(base),
    }
    return fake
  }

  it('lists the addresses that took a connection and answered as the service, in the candidates’ order', async () => {
    const fake = system({
      open: ['qbittorrent:8080', '172.18.0.9:8181', '172.18.0.7:8080', 'localhost:8080'],
      service: ['http://qbittorrent:8080', 'http://172.18.0.9:8181', 'http://localhost:8080'],
      interfaces: { eth0: [v4('172.18.0.5', '172.18.0.5/16')] } as Interfaces,
    })
    expect(await findService('qbittorrent', ['localhost'], new AbortController().signal, { system: fake })).toEqual([
      'http://qbittorrent:8080',
      'http://localhost:8080',
      'http://172.18.0.9:8181',
    ])
    // Every candidate on each usual port, a few at a time.
    expect(fake.tried).toHaveLength((3 + 1 + 253) * USUAL.qbittorrent.ports.length)
    expect(fake.most).toBe(PARALLEL)
  })

  it('lists a service found by name once, not again at the name’s address', async () => {
    const fake = system({
      open: ['prowlarr:9696', '172.18.0.3:9696', '172.18.0.4:9696'],
      service: ['http://prowlarr:9696', 'http://172.18.0.3:9696', 'http://172.18.0.4:9696'],
      names: { prowlarr: '172.18.0.3' },
      interfaces: { eth0: [v4('172.18.0.5', '172.18.0.5/16')] } as Interfaces,
    })
    expect(await findService('prowlarr', [], new AbortController().signal, { system: fake })).toEqual(['http://prowlarr:9696', 'http://172.18.0.4:9696'])
  })

  it('tries the ports it’s given', async () => {
    const fake = system({ open: ['localhost:1234'], service: ['http://localhost:1234'] })
    expect(await findService('prowlarr', ['localhost'], new AbortController().signal, { system: fake, ports: [1234] })).toEqual(['http://localhost:1234'])
    expect(fake.tried).toEqual(['prowlarr:1234', 'localhost:1234'])
  })

  it('tries nothing more once the request is gone', async () => {
    const abort = new AbortController()
    abort.abort()
    const fake = system({ open: ['localhost:9696'], service: ['http://localhost:9696'] })
    expect(await findService('prowlarr', ['localhost'], abort.signal, { system: fake })).toEqual([])
    expect(fake.tried).toEqual([])
  })
})

describe('opens', () => {
  it('takes a listening port for open, and lets the connection and its listener on the caller’s signal go', async () => {
    let closed: () => void = () => {}
    const gone = new Promise<void>((resolve) => (closed = resolve))
    const server = createServer((socket) => socket.on('close', closed))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const signal = new AbortController().signal
    expect(await opens('127.0.0.1', port, 60_000, signal)).toBe(true)
    expect(await settlesWithin(gone, 1000)).toBe(true)
    expect(getEventListeners(signal, 'abort')).toEqual([])
    server.close()
  })

  it('takes a closed port for not open at once, not after its time limit', async () => {
    const pending = opens('127.0.0.1', Number(new URL(CLOSED_ADDRESS).port), 60_000, new AbortController().signal)
    expect(await settlesWithin(pending, 1000)).toBe(true)
    expect(await pending).toBe(false)
  })

  it('gives a host that doesn’t answer up after its time limit, or when the request is gone', async () => {
    // A TEST-NET address, which no host answers (RFC 5737). Where it's routed, as on CI's runners and
    // the owner's Mac, the connect hangs and the limit ends it; on a network with no route it fails
    // at once, and the first assertion passes on that error rather than on the limit.
    expect(await settlesWithin(opens('192.0.2.1', 80, 50, new AbortController().signal), 1000)).toBe(true)
    expect(await opens('192.0.2.1', 80, 50, new AbortController().signal)).toBe(false)
    const abort = new AbortController()
    const pending = opens('192.0.2.1', 80, 60_000, abort.signal)
    abort.abort()
    expect(await settlesWithin(pending, 1000)).toBe(true)
    expect(await pending).toBe(false)
  })

  /** A lookup that answers `address` after `ms`, or never, as getaddrinfo does stuck behind slower lookups (#625). */
  function slowLookup(ms?: number, address = '127.0.0.1'): LookupFunction {
    return ((_host: string, options: { all?: boolean }, callback: (...answer: unknown[]) => void) => {
      if (ms === undefined) return
      setTimeout(() => (options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)), ms)
    }) as LookupFunction
  }

  it('gives a resolved name that doesn’t answer up after the connect’s time limit, not the lookup’s', async () => {
    // The TEST-NET address of the test above; where it isn't routed, this passes on the error.
    const pending = opens('qbittorrent.test', 80, 50, new AbortController().signal, { lookupName: slowLookup(0, '192.0.2.1'), lookupMs: 60_000 })
    expect(await settlesWithin(pending, 1000)).toBe(true)
    expect(await pending).toBe(false)
  })

  it('starts the connect’s time limit once the name has resolved (#625)', async () => {
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    expect(await opens('qbittorrent.test', port, 200, new AbortController().signal, { lookupName: slowLookup(400) })).toBe(true)
    server.close()
  })

  it('gives a name that doesn’t resolve up after the lookup’s own time limit', async () => {
    const pending = opens('qbittorrent.test', 80, 60_000, new AbortController().signal, { lookupName: slowLookup(), lookupMs: 50 })
    expect(await settlesWithin(pending, 1000)).toBe(true)
    expect(await pending).toBe(false)
  })
})

describe('identifies', () => {
  const signal = () => new AbortController().signal

  it('takes qBittorrent asking for a login, letting the server in, or refusing the Host for it', async () => {
    expect(await identifies('qbittorrent', (await fakeQbittorrent()).base, signal())).toBe(true)
    expect(await identifies('qbittorrent', (await fakeQbittorrent({ authBypass: true })).base, signal())).toBe(true)
    expect(await identifies('qbittorrent', (await fakeQbittorrent({ webUiPort: 1 })).base, signal())).toBe(true)
  })

  it('takes Prowlarr by its sign-in page, without its key', async () => {
    const prowlarr = await fakeProwlarr()
    expect(await identifies('prowlarr', prowlarr.base, signal())).toBe(true)
    expect(prowlarr.seen).toEqual([{ url: '/login', key: undefined }])
  })

  it.each([
    ['a 403 without qBittorrent’s headers', (response: import('node:http').ServerResponse) => {
      response.statusCode = 403
      response.end('Forbidden')
    }],
    ['qBittorrent’s headers on another 403', (response: import('node:http').ServerResponse) => {
      response.statusCode = 403
      response.setHeader('X-XSS-Protection', '1; mode=block')
      response.end('<h1>Forbidden</h1>')
    }],
    ['qBittorrent’s headers and text on another status', (response: import('node:http').ServerResponse) => {
      response.statusCode = 401
      response.setHeader('X-XSS-Protection', '1; mode=block')
      response.end('Forbidden')
    }],
    ['a page that isn’t a version', (response: import('node:http').ServerResponse) => response.end('<!doctype html><title>Login - Sonarr</title>')],
  ])('takes nothing else for qBittorrent or Prowlarr: %s', async (_, answer) => {
    const base = await listen((_request, response) => answer(response))
    expect(await identifies('qbittorrent', base, signal())).toBe(false)
    expect(await identifies('prowlarr', base, signal())).toBe(false)
  })

  it('reads only the start of an answer that never ends, and gives it up', async () => {
    const chunk = Buffer.alloc(16_384, 'x')
    const endless = await listen((_request, response) => {
      const pump = () => {
        while (!response.destroyed && response.write(chunk));
        if (!response.destroyed) response.once('drain', pump)
      }
      pump()
    })
    expect(await settlesWithin(identifies('qbittorrent', endless, signal()), 1000)).toBe(true)
    expect(await settlesWithin(identifies('prowlarr', endless, signal()), 1000)).toBe(true)
  })

  it('takes nothing for an address that doesn’t answer, or a request that’s gone', async () => {
    expect(await identifies('qbittorrent', CLOSED_ADDRESS, signal())).toBe(false)
    const stalled = await listen(() => undefined)
    const abort = new AbortController()
    const pending = identifies('prowlarr', stalled, abort.signal)
    abort.abort()
    expect(await settlesWithin(pending, 1000)).toBe(true)
    expect(await pending).toBe(false)
  })
})

describe('systemOnDisk.resolve', () => {
  it('gives a name’s IPv4 address, and nothing for a name that doesn’t resolve', async () => {
    expect(await systemOnDisk.resolve('localhost')).toBe('127.0.0.1')
    expect(await systemOnDisk.resolve('qbittorrent.invalid')).toBeUndefined()
  })
})
