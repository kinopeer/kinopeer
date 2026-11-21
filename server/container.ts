import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import type { SourceAddress } from '../src/api/settings/types.ts'

/**
 * What Kinopeer's server can tell about the container it runs in, for the two setup hints of #509:
 * an address on localhost, which inside the container is Kinopeer itself, and qBittorrent's auth
 * bypass, which covers the host or the LAN while Kinopeer comes from the container's network.
 */
export interface Container {
  /**
   * The host's name or address as the container reaches it: `host.docker.internal` where it
   * resolves (Docker Desktop, or `extra_hosts: host-gateway`), else the default gateway, which on a
   * Docker network is the host. Undefined when neither is known.
   */
  hostAddress: () => Promise<string | undefined>
  /**
   * The address qBittorrent sees Kinopeer's requests come from, and its network's subnet, for a
   * service at `host`; undefined when it can't be told (see `sourceOf`).
   */
  sourceFor: (host: string) => Promise<SourceAddress | undefined>
}

/** What `container` reads from the system: the real one by default, a fake in tests. */
export interface ContainerSystem {
  exists: (path: string) => boolean
  readFile: (path: string) => string | undefined
  /** An IPv4 address for a host name, or undefined when it doesn't resolve. */
  resolve: (host: string) => Promise<string | undefined>
  /** The local address a socket to `ip` would go out from (a UDP connect sends nothing). */
  localAddressTo: (ip: string) => Promise<string | undefined>
  interfaces: () => ReturnType<typeof networkInterfaces>
}

/** The image sets KINOPEER_CONTAINER=1; Docker writes /.dockerenv, Podman /run/.containerenv. */
export function inContainer(env: Record<string, string | undefined>, system: Pick<ContainerSystem, 'exists'>): boolean {
  return env.KINOPEER_CONTAINER === '1' || system.exists('/.dockerenv') || system.exists('/run/.containerenv')
}

/** Host names that are this machine: inside a container, the container itself (#509). */
export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

/** `base` with its host replaced by `host`, the port and path kept. */
export function atHost(base: string, host: string): string {
  const url = new URL(base)
  url.hostname = host
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/** The default gateway in /proc/net/route, whose addresses are hex in the kernel's (little-endian) byte order. */
export function defaultGateway(routes: string): string | undefined {
  for (const line of routes.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/)
    if (destination !== '00000000' || !gateway || !/^[0-9A-Fa-f]{8}$/.test(gateway)) continue
    const bytes = gateway.match(/../g)!.map((byte) => parseInt(byte, 16))
    return bytes.reverse().join('.')
  }
  return undefined
}

function ipv4ToNumber(ip: string): number | undefined {
  const parts = ip.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return undefined
  return parts.reduce((value, part) => value * 256 + Number(part), 0)
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.')
}

/**
 * Where qBittorrent at `serviceIp` sees requests from `local` come from, by the server's
 * interfaces: `local` itself and its network's subnet when `serviceIp` is on that network, the
 * host's gateway among them; undefined otherwise, since a request routed past the gateway leaves
 * with the host's address, which the hint would name wrongly. IPv4 only.
 */
export function sourceOf(local: string, serviceIp: string, interfaces: ReturnType<typeof networkInterfaces>): SourceAddress | undefined {
  const service = ipv4ToNumber(serviceIp)
  if (service === undefined) return undefined
  for (const entry of Object.values(interfaces).flat()) {
    if (!entry || entry.family !== 'IPv4' || entry.address !== local || !entry.cidr) continue
    const bits = Number(entry.cidr.split('/')[1])
    const size = 2 ** (32 - bits)
    const network = Math.floor(ipv4ToNumber(local)! / size) * size
    if (Math.floor(service / size) * size !== network) return undefined
    return { address: local, subnet: `${numberToIpv4(network)}/${bits}` }
  }
  return undefined
}

/** How long a name may take to resolve for a hint, which the form waits for. */
const RESOLVE_TIMEOUT_MS = 2_000

const systemOnDisk: ContainerSystem = {
  exists: existsSync,
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  resolve: async (host) => {
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RESOLVE_TIMEOUT_MS).unref())
    const found = lookup(host, { family: 4 }).then(
      (answer) => answer.address,
      () => undefined,
    )
    return Promise.race([found, timeout])
  },
  localAddressTo: (ip) =>
    new Promise((resolve) => {
      const socket = createSocket('udp4')
      let settled = false
      const done = (address: string | undefined) => {
        if (settled) return
        settled = true
        socket.close()
        resolve(address)
      }
      socket.on('error', () => done(undefined))
      // Any port: a UDP connect only picks the route and the local address.
      socket.connect(9, ip, () => done(socket.address().address))
    }),
  interfaces: networkInterfaces,
}

/** The container's hints, or undefined outside a container, where localhost is the service's host. */
export function container(env: Record<string, string | undefined>, system: ContainerSystem = systemOnDisk): Container | undefined {
  if (!inContainer(env, system)) return undefined
  return {
    hostAddress: async () => {
      if (await system.resolve('host.docker.internal')) return 'host.docker.internal'
      const routes = system.readFile('/proc/net/route')
      return routes === undefined ? undefined : defaultGateway(routes)
    },
    sourceFor: async (host) => {
      const ip = ipv4ToNumber(host) === undefined ? await system.resolve(host.replace(/^\[|\]$/g, '')) : host
      if (!ip || isLoopback(ip)) return undefined
      const local = await system.localAddressTo(ip)
      return local ? sourceOf(local, ip, system.interfaces()) : undefined
    },
  }
}
