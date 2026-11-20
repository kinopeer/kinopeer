import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PushEndpointBody, PushErrorBody, PushKey, PushPayload, PushSubscriptionBody } from '../src/api/push/types.ts'
import type { NotifyLanguage, ServerSettings } from '../src/api/settings/types.ts'
import { abandoned } from './abandoned.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import { isNotifyLanguage, notifyText } from './notifyText.ts'
import type { Middleware } from './prowlarr.ts'
import { MAX_PAYLOAD, PushUnavailable, generateVapidKey, isPushEndpoint, isPushKeys, sendPush, vapidPublicKey, type PushTarget, type VapidKey } from './webPush.ts'

/** A device that gets notifications: its subscription, and the language it was turned on in. */
export interface StoredSubscription extends PushTarget {
  language: NotifyLanguage
  /** When it was saved (ms), so the oldest goes first past MAX_SUBSCRIPTIONS. */
  added: number
}

/** `push.json` in the data directory: the server's VAPID key pair and the devices' subscriptions. */
export interface StoredPush {
  vapid?: VapidKey
  subscriptions?: StoredSubscription[]
}

/** More devices than a household has; past it, the oldest subscription goes, so the file can't grow without end. */
export const MAX_SUBSCRIPTIONS = 50

export class PushStore extends JsonFile<StoredPush> {
  constructor(dir: string) {
    super(dir, 'push.json')
  }

  /** The devices that get notifications. */
  get subscriptions(): StoredSubscription[] {
    return this.current.subscriptions ?? []
  }

  /**
   * The server's VAPID key pair, made and saved on first need. A lost `push.json` makes a new one, and
   * the devices turn notifications on again: their subscriptions were for the old key.
   */
  async vapidKey(): Promise<VapidKey> {
    const stored = await this.change((current) => (current.vapid ? current : { ...current, vapid: generateVapidKey() }))
    return stored.vapid!
  }

  /** Saves a device, in place of the one with the same endpoint and of `replaces`. */
  save(subscription: StoredSubscription, replaces?: string): Promise<StoredPush> {
    return this.change((current) => {
      const others = (current.subscriptions ?? []).filter(({ endpoint }) => endpoint !== subscription.endpoint && endpoint !== replaces)
      return { ...current, subscriptions: [...others, subscription].slice(-MAX_SUBSCRIPTIONS) }
    })
  }

  /** Forgets these devices; writes nothing when it knows none of them. */
  forget(endpoints: string[]): Promise<StoredPush> {
    return this.change((current) => {
      const subscriptions = current.subscriptions ?? []
      const kept = subscriptions.filter(({ endpoint }) => !endpoints.includes(endpoint))
      return kept.length === subscriptions.length ? current : { ...current, subscriptions: kept }
    })
  }
}

/** The payload of a push, cut to what a push carries: a long release name is cut, not the push refused. */
export function pushPayload(payload: PushPayload): Buffer {
  let encoded = Buffer.from(JSON.stringify(payload))
  for (let body = payload.body; encoded.length > MAX_PAYLOAD && body; ) {
    body = body.slice(0, Math.floor(body.length * 0.75))
    encoded = Buffer.from(JSON.stringify({ ...payload, body: `${body}…` }))
  }
  return encoded
}

/** The test notification, in the language the device was turned on in. */
export function testPayload(language: NotifyLanguage): PushPayload {
  return { title: 'Kinopeer', body: notifyText(language, 'pushTest'), url: '/settings', tag: 'kinopeer-test' }
}

export interface PushConfig {
  store: PushStore
  /** The answer of GET /api/settings, which saving or forgetting a device answers with. */
  settings: () => Promise<ServerSettings>
  /** PUSH_TEST_ORIGIN: the integration tests' fake push service, taken besides the known ones. */
  testOrigin?: string
  /** Overridable for tests. */
  send?: typeof sendPush
}

const PREFIX = '/api/push'
const MAX_BODY_BYTES = 16 * 1024
/** A subscription's keys are a P-256 point (88 characters of base64url) and 16 bytes (22). */
const KEY = /^[A-Za-z0-9_-]{16,128}$/

function fail(response: ServerResponse, status: number, error: PushErrorBody['error']): void {
  sendJson(response, status, { error } satisfies PushErrorBody)
}

/**
 * The request's JSON, undefined when it isn't JSON. Any other value (null, a list, a number) is read
 * as an object without the fields, which every route checks one by one and refuses.
 */
function body<T>(request: IncomingMessage): Promise<Partial<T> | null | undefined> {
  return readJson(request, MAX_BODY_BYTES).then(
    (parsed) => parsed as Partial<T> | null,
    () => undefined,
  )
}

/** Answers the settings once `saving` is written; a failure to write is the middleware's 500. */
async function answerSettings(config: PushConfig, response: ServerResponse, saving: Promise<unknown>) {
  await saving
  sendJson(response, 200, await config.settings())
}

async function publicKey(config: PushConfig, _request: IncomingMessage, response: ServerResponse) {
  sendJson(response, 200, { publicKey: vapidPublicKey(await config.store.vapidKey()) } satisfies PushKey)
}

async function subscribe(config: PushConfig, request: IncomingMessage, response: ServerResponse) {
  const sent = await body<PushSubscriptionBody>(request)
  if (!sent || typeof sent.p256dh !== 'string' || !KEY.test(sent.p256dh) || typeof sent.auth !== 'string' || !KEY.test(sent.auth) || !isPushKeys(sent.p256dh, sent.auth)) {
    return fail(response, 400, 'bad-request')
  }
  if (sent.replaces !== undefined && typeof sent.replaces !== 'string') return fail(response, 400, 'bad-request')
  // A renewed subscription keeps the language its device was turned on in: the service worker that
  // renews it knows only the browser's.
  const replaced = ((await config.store.load()).subscriptions ?? []).find(({ endpoint }) => endpoint === sent.replaces)
  const language = replaced?.language ?? sent.language
  if (!isNotifyLanguage(language)) return fail(response, 400, 'bad-request')
  if (!isPushEndpoint(sent.endpoint, config.testOrigin)) return fail(response, 400, 'invalid-endpoint')
  const subscription = { endpoint: sent.endpoint, p256dh: sent.p256dh, auth: sent.auth, language, added: Date.now() }
  await answerSettings(config, response, config.store.save(subscription, sent.replaces))
}

async function unsubscribe(config: PushConfig, request: IncomingMessage, response: ServerResponse) {
  const sent = await body<PushEndpointBody>(request)
  if (typeof sent?.endpoint !== 'string') return fail(response, 400, 'bad-request')
  await answerSettings(config, response, config.store.forget([sent.endpoint]))
}

async function test(config: PushConfig, request: IncomingMessage, response: ServerResponse) {
  // Taken before the first await, as `abandoned` asks.
  const signal = abandoned(response)
  const sent = await body<PushEndpointBody>(request)
  if (typeof sent?.endpoint !== 'string') return fail(response, 400, 'bad-request')
  const subscription = ((await config.store.load()).subscriptions ?? []).find(({ endpoint }) => endpoint === sent.endpoint)
  if (!subscription) return fail(response, 404, 'unknown-device')
  const key = await config.store.vapidKey()
  let result: Awaited<ReturnType<typeof sendPush>>
  try {
    result = await (config.send ?? sendPush)(subscription, pushPayload(testPayload(subscription.language)), key, { signal })
  } catch (error) {
    if (!(error instanceof PushUnavailable)) throw error
    return fail(response, 503, 'unreachable')
  }
  if (result === 'sent') {
    response.statusCode = 204
    response.end()
  } else if (result === 'gone') {
    await config.store.forget([subscription.endpoint]).catch(() => undefined)
    fail(response, 410, 'gone')
  } else {
    fail(response, 502, 'refused')
  }
}

type Handler = (config: PushConfig, request: IncomingMessage, response: ServerResponse) => Promise<void>

/** The routes under /api/push by method and path; a route that takes a body takes only JSON. */
const ROUTES: Record<string, Handler> = {
  [`GET ${PREFIX}/key`]: publicKey,
  [`PUT ${PREFIX}/subscription`]: subscribe,
  [`DELETE ${PREFIX}/subscription`]: unsubscribe,
  [`POST ${PREFIX}/test`]: test,
}

/** The devices' push subscriptions, behind Kinopeer's own login as the rest of /api. */
export function pushMiddleware(config: PushConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinopeer.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()
    const key = `${request.method} ${path}`
    const handler = Object.hasOwn(ROUTES, key) ? ROUTES[key] : undefined
    if (!handler) return fail(response, 404, 'not-found')
    // A cross-site request with a JSON body needs a CORS preflight, which never succeeds here.
    if (request.method !== 'GET' && !isJsonRequest(request)) return fail(response, 415, 'bad-request')
    // What fails here is writing push.json, but for a bug.
    handler(config, request, response).catch(() => {
      console.warn('[kinopeer] could not write push.json; is the data directory writable?')
      // Every handler answers only after its last await, so nothing has been sent yet.
      fail(response, 500, 'storage')
    })
  }
}
