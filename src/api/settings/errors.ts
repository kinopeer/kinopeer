import type { ConnectionFailure } from '../connectionFailure'
import type { SettingsErrorBody, SourceAddress } from './types'

/**
 * Why a settings request failed: the server's code (`SettingsErrorBody`), or in the WebUI build,
 * where qBittorrent keeps the settings, `store-full` when its store for web interfaces has no room
 * for the change (`isStoreFull` in src/api/qbittorrent/webui.ts), and `mixed-content` for a
 * Prowlarr address over plain HTTP on a page served over HTTPS, which the browser won't call.
 */
export type SettingsErrorCode = SettingsErrorBody['error'] | 'store-full' | 'mixed-content'

export class SettingsError extends Error {
  readonly status: number
  readonly code?: SettingsErrorCode
  /** Why qBittorrent or Prowlarr didn't answer a check (`unreachable`), where the server could tell. */
  readonly failure?: ConnectionFailure
  /** The address was localhost inside Kinopeer's container (#509), and the host's, when known. */
  readonly container?: { hostAddress?: string }
  /** No login sent, and qBittorrent asks for one: where it sees Kinopeer come from, for its auth bypass (#509). */
  readonly source?: SourceAddress

  constructor(
    status: number,
    code?: SettingsErrorCode,
    failure?: ConnectionFailure,
    hints: Pick<SettingsErrorBody, 'container' | 'source'> = {},
  ) {
    super(`Settings request failed (${code ?? status})`)
    this.name = 'SettingsError'
    this.status = status
    this.code = code
    this.failure = failure
    this.container = hints.container
    this.source = hints.source
  }
}
