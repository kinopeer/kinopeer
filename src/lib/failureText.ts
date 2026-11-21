import type { TFunction } from 'i18next'
import type { ConnectionFailure } from '../api/connectionFailure'

/** The services' names, as every language writes them. */
export const SERVICE_NAMES = { qbittorrent: 'qBittorrent', prowlarr: 'Prowlarr' } as const

/**
 * What to check when Kinopeer's server didn't reach the service for `failure` (#508), or undefined
 * when the server couldn't tell why, so the place says what it said before.
 */
export function failureText(t: TFunction, service: keyof typeof SERVICE_NAMES, failure: ConnectionFailure | undefined): string | undefined {
  if (!failure) return undefined
  // qBittorrent's port answers only while its Web UI is on, so that's what refused says to check too.
  const key = failure === 'refused' && service === 'qbittorrent' ? 'failure.refusedWebUi' : (`failure.${failure}` as const)
  return t(key, { service: SERVICE_NAMES[service] })
}
