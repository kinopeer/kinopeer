import { createServer } from 'node:net'
import type { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONNECT_TIMEOUT_MS,
  MAX_SUBNETS,
  PARALLEL,
  USUAL,
  candidateHosts,
  findService,
  identifies,
  opens,
  pooled,
  subnetHosts,
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
    const results = await pooled([5, 1, 4, 2, 3], 2, async (ms) => {
      most = Math.max(most, ++running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running--
      return ms * 10
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
      resolve: async (host) => names[host],
      opens: async (host, port) => {
        tried.push(`${host}:${port}`)
        fake.most = Math.max(fake.most, ++running)
        await new Promise((resolve) => setTimeout(resolve, 1))
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
  it('takes a listening port for open, and a closed one for not', async () => {
    const server = createServer((socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      expect(await opens('127.0.0.1', port, CONNECT_TIMEOUT_MS, new AbortController().signal)).toBe(true)
      expect(await opens('127.0.0.1', Number(new URL(CLOSED_ADDRESS).port), CONNECT_TIMEOUT_MS, new AbortController().signal)).toBe(false)
    } finally {
      server.close()
    }
  })

  it('gives a host that doesn’t answer up after its time limit, or when the request is gone', async () => {
    // A TEST-NET address, which no host answers (RFC 5737).
    expect(await settlesWithin(opens('192.0.2.1', 80, 50, new AbortController().signal), 1000)).toBe(true)
    expect(await opens('192.0.2.1', 80, 50, new AbortController().signal)).toBe(false)
    const abort = new AbortController()
    const pending = opens('192.0.2.1', 80, 60_000, abort.signal)
    abort.abort()
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
    ['a page that isn’t a version', (response: import('node:http').ServerResponse) => response.end('<!doctype html><title>Login - Sonarr</title>')],
  ])('takes nothing else for qBittorrent or Prowlarr: %s', async (_, answer) => {
    const base = await listen((_request, response) => answer(response))
    expect(await identifies('qbittorrent', base, signal())).toBe(false)
    expect(await identifies('prowlarr', base, signal())).toBe(false)
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
