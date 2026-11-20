import { ECDH, createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type JsonWebKey } from 'node:crypto'

/**
 * Web Push from the server, with Node's own crypto (the image carries no node_modules): the payload
 * encrypted for one subscription as RFC 8291 says (`aes128gcm`, RFC 8188), and the request signed
 * with the server's VAPID key (RFC 8292), so the push service takes it only from this server.
 */

/** What a browser's PushSubscription gives the server: where to send, and the keys to encrypt for. */
export interface PushTarget {
  endpoint: string
  /** The browser's P-256 public key, uncompressed, base64url. */
  p256dh: string
  /** The browser's 16-byte authentication secret, base64url. */
  auth: string
}

/** The server's VAPID key pair: a P-256 private key as a JWK, which also holds its public point. */
export type VapidKey = Required<Pick<JsonWebKey, 'kty' | 'crv' | 'x' | 'y' | 'd'>>

/** A new VAPID key pair, generated once per server and kept in its data directory. */
export function generateVapidKey(): VapidKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const { kty, crv, x, y, d } = privateKey.export({ format: 'jwk' })
  return { kty: kty!, crv: crv!, x: x!, y: y!, d: d! }
}

/** The public half as browsers take it for `applicationServerKey`: the uncompressed point, base64url. */
export function vapidPublicKey(key: VapidKey): string {
  return Buffer.concat([Buffer.of(4), Buffer.from(key.x, 'base64url'), Buffer.from(key.y, 'base64url')]).toString('base64url')
}

/** How long a VAPID signature is good for; RFC 8292 allows up to a day. */
const VAPID_TTL_S = 12 * 60 * 60

/**
 * Who runs the server, as RFC 8292's `sub` asks, which Apple's push service requires. Kinopeer is
 * self-hosted and has no operator's address to give, so it names the project.
 */
export const VAPID_SUBJECT = 'https://github.com/kinopeer/kinopeer'

/** The `Authorization` header for a push to `endpoint`, signed with `key` at `now` (ms). */
export function vapidAuthorization(endpoint: string, key: VapidKey, now: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_TTL_S, sub: VAPID_SUBJECT }
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode(claims)}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey({ key, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${vapidPublicKey(key)}`
}

/** The one record's size the body declares; a payload under it fits in one record. */
const RECORD_SIZE = 4096

/** The most a push service must take (RFC 8030), less what encryption adds: the header, the delimiter and the tag. */
export const MAX_PAYLOAD = RECORD_SIZE - 86 - 1 - 16

/** For the tests: RFC 8291's example fixes the server's ephemeral key and the salt. */
export interface EncryptOptions {
  ephemeral?: ECDH
  salt?: Buffer
}

/** `payload` encrypted for `target` as RFC 8291 says: one `aes128gcm` record with its header. */
export function encryptPayload(payload: Buffer, target: Pick<PushTarget, 'p256dh' | 'auth'>, options: EncryptOptions = {}): Buffer {
  if (payload.length > MAX_PAYLOAD) throw new RangeError(`a push payload holds ${MAX_PAYLOAD} bytes, not ${payload.length}`)
  const browserKey = Buffer.from(target.p256dh, 'base64url')
  const authSecret = Buffer.from(target.auth, 'base64url')
  const ephemeral = options.ephemeral ?? createECDH('prime256v1')
  if (!options.ephemeral) ephemeral.generateKeys()
  const serverKey = ephemeral.getPublicKey()
  const salt = options.salt ?? randomBytes(16)

  const derive = (key: Buffer, salt: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', key, salt, info, length))
  const shared = ephemeral.computeSecret(browserKey)
  const ikm = derive(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey]), 32)
  const contentKey = derive(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = derive(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce)
  // 2 marks the last (and only) record; no padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.of(2)])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(serverKey.length, 20)
  return Buffer.concat([header, serverKey, body])
}

/** How long a push service may take to answer before the push is given up as unanswered. */
export const PUSH_TIMEOUT_MS = 15_000

/** How long a push service keeps a push for a device that's offline: a finished download is news for a day. */
export const PUSH_TTL_S = 24 * 60 * 60

/** The push service didn't answer, or answered that it can't now; `retryAfterMs` when it said how long to wait. */
export class PushUnavailable extends Error {
  readonly retryAfterMs?: number

  constructor(retryAfterMs?: number) {
    super('The push service did not answer')
    this.name = 'PushUnavailable'
    this.retryAfterMs = retryAfterMs
  }
}

/** `Retry-After` in milliseconds from `now`, as seconds or as a date, else undefined. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined
  const ms = /^\d+$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - now
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

export interface SendPushOptions {
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => number
}

/**
 * Sends `payload` to `target`'s push service. Resolves `sent` when it took the push, `gone` when the
 * subscription no longer exists (404, 410), so the server forgets it, and `refused` for any other
 * refusal (a redirect among them), which sending again won't change. Throws `PushUnavailable` when it
 * didn't answer, or answered 429 or a 5xx.
 */
export async function sendPush(target: PushTarget, payload: Buffer, key: VapidKey, options: SendPushOptions = {}): Promise<'sent' | 'gone' | 'refused'> {
  const now = options.now ?? Date.now
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs ?? PUSH_TIMEOUT_MS)])
  // Built before the request, so a key that can't be used throws as itself, not as a service that
  // didn't answer, which would be sent again forever.
  const headers = {
    Authorization: vapidAuthorization(target.endpoint, key, now()),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(PUSH_TTL_S),
    Urgency: 'normal',
  }
  const body = encryptPayload(payload, target)
  let response: Response
  try {
    // A redirect isn't followed: the allowlist checks only the address the browser gave, and a
    // redirect could lead anywhere, the server's own network included. Its 3xx counts as refused.
    response = await fetch(target.endpoint, { method: 'POST', headers, body, signal, redirect: 'manual' })
  } catch {
    // Never the fetch's own error: the endpoint is a secret of the device's.
    throw new PushUnavailable()
  }
  // Nothing in the answer is read but its status; drain it so the connection is let go.
  await response.arrayBuffer().catch(() => undefined)
  if (response.status === 429 || response.status >= 500) throw new PushUnavailable(retryAfterMs(response.headers.get('Retry-After'), now()))
  if (response.ok) return 'sent'
  return response.status === 404 || response.status === 410 ? 'gone' : 'refused'
}

/**
 * The push services browsers subscribe with, by their own hosts, not their companies' whole domains:
 * Chrome's and other Chromium browsers' (Google's FCM), Firefox's (Mozilla's autopush), Safari's
 * (Apple's) and Edge's (Microsoft's WNS). A name starting with a dot takes the hosts under it.
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', '.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

const isPushServiceHost = (host: string) =>
  PUSH_SERVICE_HOSTS.some((name) => (name.startsWith('.') ? host.endsWith(name) : host === name))

/**
 * Whether a subscription's keys can be encrypted for: `p256dh` a point of P-256, uncompressed (65
 * bytes from 0x04), and `auth` 16 bytes, as RFC 8291 has them. A key that isn't fails every push.
 */
export function isPushKeys(p256dh: string, auth: string): boolean {
  const point = Buffer.from(p256dh, 'base64url')
  if (point.length !== 65 || point[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) return false
  try {
    // Throws for 65 bytes that aren't a point on the curve.
    ECDH.convertKey(point, 'prime256v1')
    return true
  } catch {
    return false
  }
}

/**
 * Whether the server may send to `endpoint`. A browser hands the endpoint over and the server sends
 * to it, so only the known push services over https are taken, not an address on the server's
 * network. `testOrigin` (PUSH_TEST_ORIGIN) adds the integration tests' fake service.
 */
export function isPushEndpoint(endpoint: unknown, testOrigin?: string): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (testOrigin && url.origin === testOrigin) return true
  return url.protocol === 'https:' && !url.port && isPushServiceHost(url.hostname)
}
