import type { lookup } from 'node:dns/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atHost, container, defaultGateway, inContainer, isLoopback, localAddressTo, ownNetwork, resolver, sourceOf, systemOnDisk, type ContainerSystem, type UdpSocket } from './container.ts'
import { settlesWithin } from './test/fakes.ts'

/** /proc/net/route on a Docker network: the default route through 172.18.0.1, then the network's own. */
const ROUTES = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0
eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
`

/** The container's interfaces as os.networkInterfaces() gives them: loopback, then the Docker network. */
const INTERFACES = {
  lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
  eth0: [
    { address: 'fe80::42:acff:fe12:5', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '02:42:ac:12:00:05', internal: false, cidr: 'fe80::42:acff:fe12:5/64', scopeid: 2 },
    { address: '172.18.0.5', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:ac:12:00:05', internal: false, cidr: '172.18.0.5/16' },
  ],
} as ReturnType<typeof networkInterfaces>

/** A container's system: files that exist, names that resolve, and the route out of it. */
function system({
  files = { '/.dockerenv': '', '/proc/net/route': ROUTES } as Record<string, string>,
  names = {} as Record<string, string>,
  /** The address a socket to the service goes out from; null when there's no route. */
  local = '172.18.0.5' as string | null,
} = {}): ContainerSystem & { resolved: string[] } {
  const resolved: string[] = []
  return {
    resolved,
    exists: (path) => path in files,
    readFile: (path) => files[path],
    resolve: async (host) => {
      resolved.push(host)
      return names[host]
    },
    localAddressTo: async () => local ?? undefined,
    interfaces: () => INTERFACES,
  }
}

describe('inContainer', () => {
  it.each([
    ['the image’s variable', { KINOPEER_CONTAINER: '1' }, {}],
    ['Docker’s file', {}, { '/.dockerenv': '' }],
    ['Podman’s file', {}, { '/run/.containerenv': '' }],
  ])('tells a container by %s', (_, env, files) => {
    expect(inContainer(env, system({ files }))).toBe(true)
  })

  it('tells none without them', () => {
    expect(inContainer({ KINOPEER_CONTAINER: '0' }, system({ files: {} }))).toBe(false)
  })
})

describe('ownNetwork', () => {
  it('takes a container for one with a network of its own', () => {
    expect(ownNetwork(system())).toBe(true)
    expect(container({}, system())!.ownNetwork).toBe(true)
  })

  it.each(['/sys/class/net/docker0', '/sys/class/net/podman0'])('takes one that sees the host’s %s for one under host networking', (bridge) => {
    const host = system({ files: { '/.dockerenv': '', [bridge]: '' } })
    expect(ownNetwork(host)).toBe(false)
    expect(container({}, host)!.ownNetwork).toBe(false)
  })
})

describe('isLoopback', () => {
  it.each(['localhost', 'LOCALHOST', 'kinopeer.localhost', '127.0.0.1', '127.1.2.3', '127.10.20.30', '[::1]', '[::]', '0.0.0.0', '[::ffff:7f00:1]', '[::ffff:7f01:203]'])('takes %s for this machine', (host) => {
    expect(isLoopback(host)).toBe(true)
  })

  // A name that only starts or ends like a loopback address is another host's (`127.0.0.1.example.com` resolves in public DNS).
  it.each(['qbittorrent', '192.168.1.10', '172.17.0.1', 'localhost.example.com', '128.0.0.1', '[::2]', '127.0.0.1.example.com', 'x127.0.0.1', '[::ffff:c0a8:10a]', '[::ffff:8000:1]', '[::ffff:7f00:1]x'])('takes %s for another', (host) => {
    expect(isLoopback(host)).toBe(false)
  })
})

describe('atHost', () => {
  it('replaces the host and keeps the scheme, the port and the path', () => {
    expect(atHost('https://localhost:8443/qbt', 'host.docker.internal')).toBe('https://host.docker.internal:8443/qbt')
    expect(atHost('http://127.0.0.1:8080', '172.17.0.1')).toBe('http://172.17.0.1:8080')
    expect(atHost('http://localhost:8080/qbt//', '172.17.0.1')).toBe('http://172.17.0.1:8080/qbt')
  })
})

describe('defaultGateway', () => {
  it('reads the default route’s gateway in the kernel’s byte order', () => {
    expect(defaultGateway(ROUTES)).toBe('172.18.0.1')
  })

  it('finds none without a default route, or with a gateway it can’t read', () => {
    expect(defaultGateway(ROUTES.split('\n').filter((line) => !line.includes('\t00000000\t010012AC')).join('\n'))).toBeUndefined()
    expect(defaultGateway(ROUTES.replace('010012AC', 'XYZ'))).toBeUndefined()
    // Eight hex digits exactly, not eight among more.
    expect(defaultGateway(ROUTES.replace('010012AC', 'Z010012AC'))).toBeUndefined()
    expect(defaultGateway(ROUTES.replace('010012AC', '010012ACZ'))).toBeUndefined()
    expect(defaultGateway('')).toBeUndefined()
  })

  it('finds none for a default route with no gateway, a WireGuard or point-to-point device’s', () => {
    expect(defaultGateway(ROUTES.replace('010012AC', '00000000'))).toBeUndefined()
  })
})

describe('sourceOf', () => {
  it('names the address and its subnet for a service on the same network, the host’s gateway among them', () => {
    expect(sourceOf('172.18.0.5', '172.18.0.3', INTERFACES)).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
    expect(sourceOf('172.18.0.5', '172.18.0.1', INTERFACES)).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
  })

  it('names nothing for a service past the gateway, which sees the host’s address', () => {
    expect(sourceOf('172.18.0.5', '192.168.1.10', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', '172.19.0.1', INTERFACES)).toBeUndefined()
  })

  it('names nothing for an address no interface has, or that isn’t IPv4', () => {
    expect(sourceOf('172.18.0.9', '172.18.0.3', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', 'fe80::1', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', '172.18.0.300', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', '172.18.3', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', '172.18.0.+3', INTERFACES)).toBeUndefined()
    expect(sourceOf('172.18.0.5', '172.18.0.3 ', INTERFACES)).toBeUndefined()
  })

  it('takes 255 in an address', () => {
    expect(sourceOf('172.18.0.5', '172.18.255.255', INTERFACES)).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
  })
})

describe('container', () => {
  it('is none outside a container', () => {
    expect(container({}, system({ files: {} }))).toBeUndefined()
  })

  it('takes host.docker.internal for the host where it resolves, else the default gateway', async () => {
    expect(await container({}, system({ names: { 'host.docker.internal': '192.168.65.254' } }))!.hostAddress()).toBe('host.docker.internal')
    expect(await container({}, system())!.hostAddress()).toBe('172.18.0.1')
    expect(await container({}, system({ files: { '/.dockerenv': '' } }))!.hostAddress()).toBeUndefined()
  })

  it('says where a service by name or address sees Kinopeer come from', async () => {
    const byName = system({ names: { qbittorrent: '172.18.0.3' } })
    expect(await container({}, byName)!.sourceFor('qbittorrent')).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
    const byAddress = system()
    expect(await container({}, byAddress)!.sourceFor('172.18.0.1')).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
    // An address needs no lookup.
    expect(byAddress.resolved).toEqual([])
    // Three numbers are a name, not an address.
    const threeParts = system({ names: { '172.18.3': '172.18.0.3' } })
    expect(await container({}, threeParts)!.sourceFor('172.18.3')).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
    expect(threeParts.resolved).toEqual(['172.18.3'])
  })

  it('says nothing for a service it can’t resolve or route to, or on localhost, which is the container', async () => {
    expect(await container({}, system())!.sourceFor('nowhere')).toBeUndefined()
    expect(await container({}, system({ local: null }))!.sourceFor('172.18.0.3')).toBeUndefined()
    expect(await container({}, system({ names: { localhost: '127.0.0.1' } }))!.sourceFor('localhost')).toBeUndefined()
    expect(await container({}, system())!.sourceFor('127.0.0.1')).toBeUndefined()
    // IPv6, as a URL keeps it, isn't looked up.
    const v6 = system({ names: { 'fe80::1': '172.18.0.3' } })
    expect(await container({}, v6)!.sourceFor('[fe80::1]')).toBeUndefined()
    expect(v6.resolved).toEqual([])
  })
})

describe('the system on disk', () => {
  it('says which files exist and reads them, and nothing for a file that isn’t there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinopeer-container-'))
    try {
      await writeFile(join(dir, 'route'), ROUTES)
      expect(systemOnDisk.exists(join(dir, 'route'))).toBe(true)
      expect(systemOnDisk.exists(join(dir, 'missing'))).toBe(false)
      expect(systemOnDisk.readFile(join(dir, 'route'))).toBe(ROUTES)
      expect(systemOnDisk.readFile(join(dir, 'missing'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves a name to its IPv4 address, and none for one that doesn’t exist', async () => {
    expect(await systemOnDisk.resolve('localhost')).toBe('127.0.0.1')
    expect(await systemOnDisk.resolve('qbittorrent.invalid')).toBeUndefined()
  })

  it('gives a lookup up after its time limit', async () => {
    const stalled = (() => new Promise(() => undefined)) as unknown as typeof lookup
    expect(await settlesWithin(resolver(stalled, 10)('qbittorrent'), 1000)).toBe(true)
    expect(await resolver(stalled, 10)('qbittorrent')).toBeUndefined()
  })

  it('finds the address a socket goes out from', async () => {
    expect(await systemOnDisk.localAddressTo('127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('localAddressTo', () => {
  /**
   * A UDP socket that connects, or fails, as told, and counts its closes. As Node's dgram does, a
   * failed connect goes to the connect callback, not to 'error', and leaves the address 0.0.0.0.
   */
  function socket({ connects, failsAfter = false }: { connects: boolean; failsAfter?: boolean }) {
    let onError: (() => void) | undefined
    const fake = {
      closes: 0,
      on: (_event: string, listener: () => void) => {
        onError = listener
        return fake
      },
      connect: (_port: number, _ip: string, connected: (error?: Error) => void) => {
        if (!connects) return connected(Object.assign(new Error('connect EACCES'), { code: 'EACCES' }))
        connected()
        if (failsAfter) onError?.()
      },
      address: () => ({ address: connects ? '172.18.0.5' : '0.0.0.0', family: 'IPv4', port: 40000 }),
      close: () => {
        fake.closes++
        return fake
      },
    }
    return fake
  }

  it('gives the local address and closes the socket', async () => {
    const connected = socket({ connects: true })
    expect(await localAddressTo('172.18.0.3', connected as unknown as UdpSocket)).toBe('172.18.0.5')
    expect(connected.closes).toBe(1)
  })

  it('gives none, and closes the socket, where it can’t connect', async () => {
    const failed = socket({ connects: false })
    expect(await localAddressTo('172.18.0.3', failed as unknown as UdpSocket)).toBeUndefined()
    expect(failed.closes).toBe(1)
  })

  it('settles once, should the socket also fail after connecting', async () => {
    const both = socket({ connects: true, failsAfter: true })
    expect(await localAddressTo('172.18.0.3', both as unknown as UdpSocket)).toBe('172.18.0.5')
    expect(both.closes).toBe(1)
  })
})

describe('container on this machine', () => {
  // The real lookups and the UDP route, which the tests above fake: what the server runs in its image.
  const own = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)

  it('resolves a name, and none for one that doesn’t exist', async () => {
    const real = container({ KINOPEER_CONTAINER: '1' })!
    expect(await real.sourceFor('localhost')).toBeUndefined()
    expect(await real.sourceFor('qbittorrent.invalid')).toBeUndefined()
  })

  it.skipIf(!own)('finds the address it goes out from to its own network', async () => {
    const source = await container({ KINOPEER_CONTAINER: '1' })!.sourceFor(own!.address)
    expect(source?.address).toBe(own!.address)
  })
})
