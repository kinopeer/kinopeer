import type { ServerSettings, SettingsErrorBody, TmdbKeyBody } from './types'

/** Settings the Kinoseed server keeps (server/settings.ts). */
export const SETTINGS_BASE = '/api/settings'

export class SettingsError extends Error {
  readonly status: number
  readonly code?: SettingsErrorBody['error']

  constructor(status: number, code?: SettingsErrorBody['error']) {
    super(`Settings request failed (${code ?? status})`)
    this.name = 'SettingsError'
    this.status = status
    this.code = code
  }
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

async function errorFor(response: Response): Promise<SettingsError> {
  const body = isJson(response) ? ((await response.json().catch(() => ({}))) as Partial<SettingsErrorBody>) : {}
  return new SettingsError(response.status, body.error)
}

export async function getServerSettings(signal?: AbortSignal): Promise<ServerSettings> {
  const response = await fetch(SETTINGS_BASE, { credentials: 'same-origin', signal })
  // No JSON: a server without /api/settings (the SPA fallback answered).
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}

/**
 * Saves the TMDB key on the server, which checks it with TMDB first. Rejects with a SettingsError:
 * code 'invalid-key' when TMDB refuses it, 'unreachable' when TMDB doesn't answer.
 */
export async function saveTmdbKey(apiKey: string): Promise<ServerSettings> {
  const response = await fetch(`${SETTINGS_BASE}/tmdb`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey } satisfies TmdbKeyBody),
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}
