import { lookup } from 'node:dns/promises'
import { connect, isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import { answersAsProwlarr } from './prowlarr.ts'
import { answersAsQbittorrent } from './qbittorrent.ts'

/**
 * Find (#511): the addresses where qBittorrent or Prowlarr answers, from a short list of the usual
 * places and a cheap scan of the server's own network. Its scope is fixed: SPEC's decision log
 * lists what it can't find, and a setup it misses is recorded there rather than handled with
 * another rule.
 */
export type FindService = 'qbittorrent' | 'prowlarr'

/**
 * Where each service is looked for: the names its usual images and stacks give its container (a
 * VPN container whose network qBittorrent shares, gluetun's, answers for it), and its usual ports.
 */
export const USUAL: Record<FindService, { names: string[]; ports: number[] }> = {
  qbittorrent: { names: ['qbittorrent', 'qbittorrentvpn', 'gluetun'], ports: [8080, 8181] },
  prowlarr: { names: ['prowlarr'], ports: [9696] },
}

/** How many of the server's networks are scanned, each the /24 around its address. */
export const MAX_SUBNETS = 4
/** How long a host may take to take a connection: on a LAN an answer comes in milliseconds. */
export const CONNECT_TIMEOUT_MS = 300
/** How long a host that took one may take to answer as the service. */
export const IDENTIFY_TIMEOUT_MS = 3_000
/** How many connections are tried at once. */
export const PARALLEL = 128

/** What Find reads and asks: the real system by default, a fake in tests. */
export interface FindSystem {
  interfaces: () => ReturnType<typeof networkInterfaces>
  /** A name's IPv4 address, or undefined when it doesn't resolve. */
  resolve: (host: string) => Promise<string | undefined>
  /** Whether something at `host`:`port` takes a TCP connection within `ms`. */
  opens: (host: string, port: number, ms: number, signal: AbortSignal) => Promise<boolean>
  /** Whether `base` answers as `service`, without a login or a key. */
  identifies: (service: FindService, base: string, signal: AbortSignal) => Promise<boolean>
}

/**
 * Whether an IPv4 address is in a private range (RFC 1918's, and the shared 100.64.0.0/10 of
 * carrier-grade NAT and Tailscale): the server's own network, where a public one is a provider's,
 * other people's machines, which a scan of would read as a port scan (SPEC's decision log).
 */
export function isPrivate(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/**
 * Every host of the /24 around each private IPv4 address on the server's own interfaces but
 * loopback (.1 to .254), the server's own addresses left out, at most MAX_SUBNETS of them in the
 * interfaces' order. A network wider than a /24 (Docker's /16) is scanned around the server's
 * address only, and a public address not at all.
 */
export function subnetHosts(interfaces: ReturnType<typeof networkInterfaces>): string[] {
  const own = Object.values(interfaces)
    .flat()
    .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
    .map((entry) => entry!.address)
  const prefixes = [...new Set(own.filter(isPrivate).map((address) => address.split('.').slice(0, 3).join('.')))].slice(0, MAX_SUBNETS)
  return prefixes.flatMap((prefix) => Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)).filter((host) => !own.includes(host))
}

/**
 * The hosts Find tries, in the order its answers list them: the usual names, then the host as the
 * server reaches it (`near`), then the scanned subnets'.
 */
export function candidateHosts(service: FindService, near: string[], interfaces: ReturnType<typeof networkInterfaces>): string[] {
  return [...new Set([...USUAL[service].names, ...near, ...subnetHosts(interfaces)])]
}

/** Runs `task` over `items`, at most `limit` at a time, the results in the items' order. */
export async function pooled<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await task(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * The addresses where `service` answers, as `http://host:port`: each candidate host on each usual
 * port (`ports` in tests) that takes a connection and answers as the service. An address found by a
 * name drops the same port at the name's address, so one service is listed once.
 */
export async function findService(
  service: FindService,
  near: string[],
  signal: AbortSignal,
  { system = systemOnDisk, ports = USUAL[service].ports }: { system?: FindSystem; ports?: number[] } = {},
): Promise<string[]> {
  const hosts = candidateHosts(service, near, system.interfaces())
  const probes = hosts.flatMap((host) => ports.map((port) => ({ host, port })))
  const answered = await pooled(probes, PARALLEL, async ({ host, port }) => {
    if (signal.aborted || !(await system.opens(host, port, CONNECT_TIMEOUT_MS, signal))) return undefined
    const base = `http://${host}:${port}`
    return (await system.identifies(service, base, signal)) ? { host, port, base } : undefined
  })
  const found = answered.filter((probe) => probe !== undefined)
  const named = new Set(
    await Promise.all(
      found.filter(({ host }) => !isIPv4(host)).map(async ({ host, port }) => `${await system.resolve(host)}:${port}`),
    ),
  )
  return found.filter(({ host, port }) => !named.has(`${host}:${port}`)).map(({ base }) => base)
}

/** Whether something at `host`:`port` takes a TCP connection within `ms` (the name's lookup included). */
export function opens(host: string, port: number, ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    // Each step is harmless twice, so a second outcome (the timer after an error) changes nothing.
    const done = (open: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      socket.destroy()
      resolve(open)
    }
    const abort = () => done(false)
    const timer = setTimeout(() => done(false), ms)
    signal.addEventListener('abort', abort)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Whether `base` answers as `service` within IDENTIFY_TIMEOUT_MS; nothing that fails counts. */
export async function identifies(service: FindService, base: string, signal: AbortSignal): Promise<boolean> {
  const limited = AbortSignal.any([signal, AbortSignal.timeout(IDENTIFY_TIMEOUT_MS)])
  try {
    return await (service === 'qbittorrent' ? answersAsQbittorrent(base, limited) : answersAsProwlarr(base, limited))
  } catch {
    return false
  }
}

/** The real system, which Find reads by default. */
export const systemOnDisk: FindSystem = {
  interfaces: networkInterfaces,
  resolve: (host) =>
    lookup(host, { family: 4 }).then(
      (answer) => answer.address,
      () => undefined,
    ),
  opens,
  identifies,
}
