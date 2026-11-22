import type { ConnectionFailure } from '../connectionFailure'
import type { ProwlarrErrorBody } from './types'

export class ProwlarrError extends Error {
  readonly status: number
  readonly code?: ProwlarrErrorBody['error']
  /** Why Prowlarr didn't answer (`unreachable`), where the server could tell. */
  readonly failure?: ConnectionFailure

  constructor(message: string, status: number, code?: ProwlarrErrorBody['error'], failure?: ConnectionFailure) {
    super(message)
    this.name = 'ProwlarrError'
    this.status = status
    this.code = code
    this.failure = failure
  }
}

/** The server has no address or key for Prowlarr (`not-configured`), or Prowlarr rejected its key (`unauthorized`). */
export class ProwlarrSetupError extends ProwlarrError {
  constructor(status: number, code: 'not-configured' | 'unauthorized') {
    super('Prowlarr is not configured or rejected the API key', status, code)
    this.name = 'ProwlarrSetupError'
  }
}

/**
 * In the WebUI build, qBittorrent didn't give Prowlarr's address and key, which it keeps for the
 * browser (src/api/settings/webui.ts): it's qBittorrent that didn't answer, not Prowlarr. `cause` is
 * why: `UnauthorizedError` when qBittorrent's session has ended, a `TypeError` when nothing answered.
 */
export class ProwlarrKeyReadError extends Error {
  constructor(cause: unknown) {
    super('qBittorrent did not give Prowlarr’s address and key', { cause })
    this.name = 'ProwlarrKeyReadError'
  }
}
