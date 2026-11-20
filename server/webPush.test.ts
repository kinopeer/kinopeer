import { createECDH, createPublicKey, verify } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { closeServers, silentService } from './test/fakes.ts'
import { fakeBrowser, fakePushService } from './test/pushService.ts'
import {
  MAX_PAYLOAD,
  PushUnavailable,
  VAPID_SUBJECT,
  encryptPayload,
  generateVapidKey,
  isPushEndpoint,
  retryAfterMs,
  sendPush,
  vapidAuthorization,
  vapidPublicKey,
} from './webPush.ts'

afterEach(closeServers)

/** RFC 8291, Appendix A: the keys, salt and secret of its example, and the body it gives. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  browserPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  browserPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const keyOf = (privateKey: string) => {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'))
  return ecdh
}

describe('encryptPayload', () => {
  it('gives the body of RFC 8291’s example for its keys and salt', () => {
    const body = encryptPayload(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.browserPublic, auth: RFC.auth },
      { ephemeral: keyOf(RFC.serverPrivate), salt: Buffer.from(RFC.salt, 'base64url') },
    )
    expect(body.toString('base64url')).toBe(RFC.body)
  })

  it('encrypts with a key and salt of its own each time, which the browser reads', () => {
    const browser = fakeBrowser()
    const payload = Buffer.from(JSON.stringify({ title: 'Загрузка завершена' }))
    const first = encryptPayload(payload, browser.keys)
    const second = encryptPayload(payload, browser.keys)
    expect(browser.decrypt(first).toString()).toBe(payload.toString())
    expect(browser.decrypt(second).toString()).toBe(payload.toString())
    expect(first.subarray(0, 16)).not.toEqual(second.subarray(0, 16))
    expect(first.subarray(21, 86)).not.toEqual(second.subarray(21, 86))
  })

  it('the RFC’s browser reads its own example', () => {
    const browser = fakeBrowser(keyOf(RFC.browserPrivate), Buffer.from(RFC.auth, 'base64url'))
    expect(browser.decrypt(Buffer.from(RFC.body, 'base64url')).toString()).toBe(RFC.plaintext)
  })

  it('takes a payload that fills one record, and refuses a byte more', () => {
    const browser = fakeBrowser()
    const full = encryptPayload(Buffer.alloc(MAX_PAYLOAD, 'a'), browser.keys)
    expect(full.length).toBe(4096)
    expect(browser.decrypt(full).length).toBe(MAX_PAYLOAD)
    expect(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD + 1, 'a'), browser.keys)).toThrow(RangeError)
  })
})

describe('VAPID', () => {
  const key = generateVapidKey()
  const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)

  it('gives the public key as browsers take it: the uncompressed point of the key pair', () => {
    const raw = Buffer.from(vapidPublicKey(key), 'base64url')
    expect(raw.length).toBe(65)
    expect(raw[0]).toBe(4)
    expect(createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, format: 'jwk' }).export({ format: 'jwk' })).toMatchObject({
      x: raw.subarray(1, 33).toString('base64url'),
      y: raw.subarray(33).toString('base64url'),
    })
  })

  it('makes a new key pair each time', () => {
    expect(generateVapidKey().d).not.toBe(key.d)
  })

  it('signs a token for the push service’s origin, good for 12 hours, that its public key verifies', () => {
    const header = vapidAuthorization('https://push.example.org:8443/send/abc?x=1', key, NOW)
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head, claims, signature, publicKey] = match!
    expect(publicKey).toBe(vapidPublicKey(key))
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://push.example.org:8443',
      exp: NOW / 1000 + 12 * 60 * 60,
      sub: VAPID_SUBJECT,
    })
    const signed = verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(signed).toBe(true)
  })
})

describe('sendPush', () => {
  const key = generateVapidKey()
  const payload = Buffer.from(JSON.stringify({ title: 'Download finished' }))

  it('sends the payload encrypted for the device, signed, for a day, and says it went', async () => {
    const service = await fakePushService()
    const target = service.subscribe('/send/a')
    await expect(sendPush(target, payload, key)).resolves.toBe('sent')
    expect(service.pushes).toHaveLength(1)
    const [push] = service.pushes
    expect(push.payload).toEqual({ title: 'Download finished' })
    expect(push.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'normal',
    })
    expect(push.headers.authorization).toMatch(new RegExp(`^vapid t=[\\w.-]+, k=${vapidPublicKey(key)}$`))
  })

  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [400, 'refused'],
    [403, 'refused'],
    [413, 'refused'],
  ])('a push service answering %i: %s', async (status, result) => {
    const service = await fakePushService()
    const target = service.subscribe('/send/a')
    service.answers['/send/a'] = { status }
    await expect(sendPush(target, payload, key)).resolves.toBe(result)
  })

  it.each([429, 500, 503])('throws PushUnavailable on %i, with the wait the service asked for', async (status) => {
    const service = await fakePushService()
    const target = service.subscribe('/send/a')
    service.answers['/send/a'] = { status, retryAfter: '120' }
    const error = await sendPush(target, payload, key).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PushUnavailable)
    expect((error as PushUnavailable).retryAfterMs).toBe(120_000)
  })

  it('throws PushUnavailable without the endpoint when the service doesn’t answer in time', async () => {
    const { base } = await silentService()
    const error = await sendPush({ endpoint: `${base}/send/secret`, ...fakeBrowser().keys }, payload, key, { timeoutMs: 50 }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(PushUnavailable)
    expect((error as PushUnavailable).retryAfterMs).toBeUndefined()
    expect(String((error as Error).message)).not.toContain('secret')
  })
})

describe('retryAfterMs', () => {
  const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
  it.each([
    ['seconds', '30', 30_000],
    ['a date', new Date(NOW + 90_000).toUTCString(), 90_000],
    ['a date gone by', new Date(NOW - 90_000).toUTCString(), undefined],
    ['zero', '0', undefined],
    ['nothing', null, undefined],
    ['nonsense', 'soon', undefined],
    ['seconds with spaces around them', ' 120 ', 120_000],
    ['a number that isn’t whole seconds', '1e3', undefined],
  ])('%s', (_name, header, ms) => {
    expect(retryAfterMs(header, NOW)).toBe(ms)
  })
})

describe('isPushEndpoint', () => {
  it.each([
    ['Chrome’s (FCM)', 'https://fcm.googleapis.com/fcm/send/abc', true],
    ['Firefox’s', 'https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['Safari’s', 'https://web.push.apple.com/QGx', true],
    ['Edge’s', 'https://wns2-par02p.notify.windows.com/w/?token=abc', true],
    ['a known service over http', 'http://fcm.googleapis.com/fcm/send/abc', false],
    ['a known service on another port', 'https://fcm.googleapis.com:8443/fcm/send/abc', false],
    ['a host that only ends like one', 'https://evilgoogleapis.com/x', false],
    ['a known service with a login', 'https://user:pass@fcm.googleapis.com/fcm/send/abc', false],
    ['a known service with a password alone', 'https://:pass@fcm.googleapis.com/fcm/send/abc', false],
    ['an address on the server’s network', 'https://192.168.1.10/send', false],
    ['not a URL', 'fcm.googleapis.com/abc', false],
    ['as long as it may be', `https://fcm.googleapis.com/${'a'.repeat(2048 - 'https://fcm.googleapis.com/'.length)}`, true],
    ['too long', `https://fcm.googleapis.com/${'a'.repeat(2048)}`, false],
    ['not a string: a list holding an address, which a JSON body can send', ['https://fcm.googleapis.com/fcm/send/abc'], false],
  ])('%s: %s', (_name, endpoint, valid) => {
    expect(isPushEndpoint(endpoint)).toBe(valid)
  })

  it('takes the test origin PUSH_TEST_ORIGIN names, over http too, and nothing else of its host', () => {
    expect(isPushEndpoint('http://127.0.0.1:4567/send/a', 'http://127.0.0.1:4567')).toBe(true)
    expect(isPushEndpoint('http://127.0.0.1:4568/send/a', 'http://127.0.0.1:4567')).toBe(false)
    expect(isPushEndpoint('http://127.0.0.1:4567/send/a')).toBe(false)
  })
})
