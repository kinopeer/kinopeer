import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from 'node:crypto'
import type { PushTarget } from '../webPush.ts'
import { bytesOf, listen } from './fakes.ts'

/** A browser's side of a push subscription: its keys, and what it needs to read a push. */
export interface FakeBrowser {
  keys: Pick<PushTarget, 'p256dh' | 'auth'>
  /** The payload of an `aes128gcm` body encrypted for this browser, as RFC 8291 has it decrypt one. */
  decrypt: (body: Buffer) => Buffer
}

/** A browser's subscription keys; `ecdh` and `auth` fix them (RFC 8291's example). */
export function fakeBrowser(ecdh: ECDH = createECDH('prime256v1'), auth: Buffer = randomBytes(16)): FakeBrowser {
  if (!safePrivateKey(ecdh)) ecdh.generateKeys()
  const browserKey = ecdh.getPublicKey()
  return {
    keys: { p256dh: browserKey.toString('base64url'), auth: auth.toString('base64url') },
    decrypt: (body) => {
      const salt = body.subarray(0, 16)
      const keyLength = body.readUInt8(20)
      const serverKey = body.subarray(21, 21 + keyLength)
      const record = body.subarray(21 + keyLength)
      const derive = (key: Buffer, salt: Buffer, info: string | Buffer, length: number) =>
        Buffer.from(hkdfSync('sha256', key, salt, typeof info === 'string' ? Buffer.from(info) : info, length))
      const ikm = derive(ecdh.computeSecret(serverKey), auth, Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey]), 32)
      const decipher = createDecipheriv('aes-128-gcm', derive(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), derive(ikm, salt, 'Content-Encoding: nonce\0', 12))
      decipher.setAuthTag(record.subarray(record.length - 16))
      const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()])
      // The last record ends with the delimiter 2, then zeros of padding.
      const end = padded.lastIndexOf(2)
      if (end < 0 || padded.subarray(end + 1).some((byte) => byte !== 0)) throw new Error('not the last record')
      return padded.subarray(0, end)
    },
  }
}

function safePrivateKey(ecdh: ECDH): boolean {
  try {
    ecdh.getPrivateKey()
    return true
  } catch {
    return false
  }
}

/** A push the fake service took: the subscription's path, its headers, and the payload as its browser reads it. */
export interface ReceivedPush {
  path: string
  headers: Record<string, string | string[] | undefined>
  payload: unknown
}

/**
 * A push service on 127.0.0.1: each subscription is a path on it (`subscribe`), with a browser that
 * decrypts what's sent to it. A path answers `answers[path]` (201 by default), with `retryAfter` as
 * `Retry-After`; `pushes` lists what it took.
 */
export async function fakePushService() {
  const browsers = new Map<string, FakeBrowser>()
  const answers: Record<string, { status: number; retryAfter?: string }> = {}
  const pushes: ReceivedPush[] = []
  const origin = await listen(async (request, response) => {
    const path = request.url ?? ''
    const body = await bytesOf(request)
    const answer = answers[path] ?? { status: 201 }
    const browser = browsers.get(path)
    if (answer.status === 201 && browser) pushes.push({ path, headers: request.headers, payload: JSON.parse(browser.decrypt(body).toString()) })
    response.statusCode = answer.status
    if (answer.retryAfter) response.setHeader('Retry-After', answer.retryAfter)
    response.end()
  })
  return {
    origin,
    answers,
    pushes,
    /** A new subscription on the service: its endpoint and keys, as the browser hands them to Kinopeer. */
    subscribe(path: string): PushTarget {
      const browser = fakeBrowser()
      browsers.set(path, browser)
      return { endpoint: `${origin}${path}`, ...browser.keys }
    },
  }
}
