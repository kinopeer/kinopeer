import type { SettingsErrorBody, SourceAddress } from './settings/types'

/**
 * The server's setup hints for Kinopeer in a container (#509), checked as they come in: they go
 * into the page's texts, so only the shapes the server sends are taken.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const SUBNET = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/

export function isSourceAddress(value: unknown): value is SourceAddress {
  if (typeof value !== 'object' || value === null) return false
  const { address, subnet } = value as Partial<Record<keyof SourceAddress, unknown>>
  return typeof address === 'string' && IPV4.test(address) && typeof subnet === 'string' && SUBNET.test(subnet)
}

/** `SettingsErrorBody.container`: the host's address, when there is one, an http(s) address. */
export function isContainerHint(value: unknown): value is NonNullable<SettingsErrorBody['container']> {
  if (typeof value !== 'object' || value === null) return false
  const { hostAddress } = value as { hostAddress?: unknown }
  return hostAddress === undefined || (typeof hostAddress === 'string' && /^https?:\/\/[^\s]+$/.test(hostAddress))
}

/** The bridge's `x-kinopeer-source` header: the address and its subnet with a space between. */
export function parseSource(header: string | null): SourceAddress | undefined {
  const [address, subnet, ...rest] = header?.split(' ') ?? []
  const source = { address, subnet }
  return rest.length === 0 && isSourceAddress(source) ? source : undefined
}
