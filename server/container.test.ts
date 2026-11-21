import { networkInterfaces } from 'node:os'
import { describe, expect, it } from 'vitest'
import { atHost, container, defaultGateway, inContainer, isLoopback, sourceOf, type ContainerSystem } from './container.ts'

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

describe('isLoopback', () => {
  it.each(['localhost', 'LOCALHOST', 'kinopeer.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '0.0.0.0'])('takes %s for this machine', (host) => {
    expect(isLoopback(host)).toBe(true)
  })

  it.each(['qbittorrent', '192.168.1.10', '172.17.0.1', 'localhost.example.com', '128.0.0.1', '[::2]'])('takes %s for another', (host) => {
    expect(isLoopback(host)).toBe(false)
  })
})

describe('atHost', () => {
  it('replaces the host and keeps the scheme, the port and the path', () => {
    expect(atHost('https://localhost:8443/qbt', 'host.docker.internal')).toBe('https://host.docker.internal:8443/qbt')
    expect(atHost('http://127.0.0.1:8080', '172.17.0.1')).toBe('http://172.17.0.1:8080')
  })
})

describe('defaultGateway', () => {
  it('reads the default route’s gateway in the kernel’s byte order', () => {
    expect(defaultGateway(ROUTES)).toBe('172.18.0.1')
  })

  it('finds none without a default route, or with a gateway it can’t read', () => {
    expect(defaultGateway(ROUTES.split('\n').filter((line) => !line.includes('\t00000000\t010012AC')).join('\n'))).toBeUndefined()
    expect(defaultGateway(ROUTES.replace('010012AC', 'XYZ'))).toBeUndefined()
    expect(defaultGateway('')).toBeUndefined()
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
  })

  it('says nothing for a service it can’t resolve or route to, or on localhost, which is the container', async () => {
    expect(await container({}, system())!.sourceFor('nowhere')).toBeUndefined()
    expect(await container({}, system({ local: null }))!.sourceFor('172.18.0.3')).toBeUndefined()
    expect(await container({}, system({ names: { localhost: '127.0.0.1' } }))!.sourceFor('localhost')).toBeUndefined()
    expect(await container({}, system())!.sourceFor('127.0.0.1')).toBeUndefined()
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
