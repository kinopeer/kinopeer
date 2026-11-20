import type { ServerSettings } from '../settings/types'
import type { PushEndpointBody, PushErrorBody, PushKey, PushSubscriptionBody } from './types'
import { SERVER_SETTINGS_KEY } from '../settings/client'
import { fetchKinopeer } from '../fetchKinopeer'
import { sharedRequests } from '../../logic/sharedRequests'

/** The devices' push subscriptions on the Kinopeer server (server/push.ts). */
export const PUSH_BASE = '/api/push'

export class PushError extends Error {
  readonly status: number
  readonly code?: PushErrorBody['error']

  constructor(status: number, code?: PushErrorBody['error']) {
    super('Push request failed')
    this.name = 'PushError'
    this.status = status
    this.code = code
  }
}

async function call(method: string, path: string, body?: object): Promise<Response> {
  const response = await fetchKinopeer(`${PUSH_BASE}/${path}`, {
    method,
    // The JSON content type, as on every request that changes something (server/json.ts).
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    // An answer that isn't the server's JSON (a proxy's page) has no code.
    const answer = (await response.json().catch(() => ({}))) as Partial<PushErrorBody> | null
    throw new PushError(response.status, answer?.error)
  }
  return response
}

/** The server's VAPID public key, which a device subscribes with. */
export async function getPushKey(): Promise<string> {
  const response = await call('GET', 'key')
  return ((await response.json()) as PushKey).publicKey
}

/** Keeps a change's answer as the page's settings, so the torrent page's switch follows. */
async function saved(response: Response): Promise<ServerSettings> {
  const settings = (await response.json()) as ServerSettings
  sharedRequests.set(SERVER_SETTINGS_KEY, settings)
  return settings
}

/** Saves this device, so it gets notifications. Rejects with code 'invalid-endpoint' for a push service the server doesn't send to. */
export async function savePushSubscription(body: PushSubscriptionBody): Promise<ServerSettings> {
  return saved(await call('PUT', 'subscription', body))
}

/** Forgets this device: no more notifications to it. */
export async function forgetPushSubscription(endpoint: string): Promise<ServerSettings> {
  return saved(await call('DELETE', 'subscription', { endpoint } satisfies PushEndpointBody))
}

/**
 * Sends this device a test notification. Rejects with code 'unknown-device' when the server doesn't
 * know it, 'gone' when its push service says the subscription is gone (the server forgot it),
 * 'refused' or 'unreachable'.
 */
export async function testPush(endpoint: string): Promise<void> {
  await call('POST', 'test', { endpoint } satisfies PushEndpointBody)
}
