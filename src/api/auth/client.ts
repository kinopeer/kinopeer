import type { AuthErrorBody, ChangePasswordBody, PasswordBody } from './types'
import { setSignInNeed } from './signInNeed'
import { fetchKinopeer } from '../fetchKinopeer'
import { sharedRequests } from '../../logic/sharedRequests'

/** Kinopeer's own login (server/auth.ts). */
export const AUTH_BASE = '/api/auth'

/**
 * The shortest password the server takes: `MIN_PASSWORD_LENGTH` in server/auth.ts, which can't
 * import this (the image has no src/), so server/integration/auth.test.ts checks they're the same.
 */
export const MIN_PASSWORD_LENGTH = 8

export class AuthError extends Error {
  readonly status: number
  readonly code?: AuthErrorBody['error']
  /** How long to wait before trying the password again, when the server said. */
  readonly retryAfterMs?: number

  constructor(status: number, code?: AuthErrorBody['error'], retryAfterMs?: number) {
    super(`Sign-in request failed (${code ?? status})`)
    this.name = 'AuthError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

async function send(method: 'POST' | 'PUT', path: string, body?: PasswordBody | ChangePasswordBody): Promise<void> {
  // The JSON content type, as on every request that changes something (server/json.ts).
  const response = await fetchKinopeer(`${AUTH_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  if (response.ok) return
  const answer = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json().catch(() => ({}))) as Partial<AuthErrorBody>)
    : {}
  throw new AuthError(response.status, answer.error, typeof answer.retryAfterMs === 'number' ? answer.retryAfterMs : undefined)
}

/**
 * Sets the first password on a server that has none, and signs this browser in. Rejects with an
 * AuthError: code 'too-short', or 'already-set' when someone else set one first.
 */
export async function setUpPassword(password: string): Promise<void> {
  await send('POST', 'setup', { password })
  setSignInNeed(null)
}

/**
 * Signs this browser in. Rejects with an AuthError: code 'invalid-password', or 'throttled' after
 * too many wrong ones, with `retryAfterMs`.
 */
export async function signIn(password: string): Promise<void> {
  await send('POST', 'login', { password })
  setSignInNeed(null)
}

/**
 * Ends this browser's session. The answers the page keeps go with it, so nothing loaded while signed
 * in is shown again before the next sign-in asks anew.
 */
export async function signOut(): Promise<void> {
  await send('POST', 'logout')
  sharedRequests.clear()
  setSignInNeed('sign-in')
}

/**
 * Changes the password; this browser stays signed in and every other one is signed out. Rejects
 * with an AuthError: 'invalid-password' for a wrong current one, 'too-short', 'throttled', or
 * 'env-password' when KINOPEER_PASSWORD sets it.
 */
export function changePassword(current: string, password: string): Promise<void> {
  return send('PUT', 'password', { current, password })
}
