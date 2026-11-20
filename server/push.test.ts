import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSettings } from '../src/api/settings/types.ts'
import { MAX_SUBSCRIPTIONS, PushStore, pushMiddleware, pushPayload, testPayload, type StoredSubscription } from './push.ts'
import { closeServers, fakePushService, serve } from './test/fakes.ts'
import { MAX_PAYLOAD, PushUnavailable, vapidPublicKey } from './webPush.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-push-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

const device = (endpoint: string, language: 'en' | 'ru' = 'en', added = 0): StoredSubscription => ({
  endpoint,
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  language,
  added,
})

describe('PushStore', () => {
  it('makes the VAPID key once, on first need, and keeps it in push.json', async () => {
    const store = new PushStore(dir)
    await expect(stat(join(dir, 'push.json'))).rejects.toThrow()
    const [first, second] = await Promise.all([store.vapidKey(), store.vapidKey()])
    expect(second).toEqual(first)
    const again = new PushStore(dir)
    expect(await again.vapidKey()).toEqual(first)
    expect(JSON.parse(await readFile(join(dir, 'push.json'), 'utf8')).vapid).toEqual(first)
  })

  it('saves a device in place of the one with its endpoint, and of the one it replaces', async () => {
    const store = new PushStore(dir)
    await store.save(device('https://fcm.googleapis.com/a'))
    await store.save(device('https://fcm.googleapis.com/b'))
    await store.save(device('https://fcm.googleapis.com/a', 'ru', 1))
    expect(store.subscriptions.map(({ endpoint, language }) => [endpoint, language])).toEqual([
      ['https://fcm.googleapis.com/b', 'en'],
      ['https://fcm.googleapis.com/a', 'ru'],
    ])
    await store.save(device('https://fcm.googleapis.com/c'), 'https://fcm.googleapis.com/b')
    expect(store.subscriptions.map(({ endpoint }) => endpoint)).toEqual(['https://fcm.googleapis.com/a', 'https://fcm.googleapis.com/c'])
  })

  it(`keeps the newest ${MAX_SUBSCRIPTIONS} devices`, async () => {
    const store = new PushStore(dir)
    for (let index = 0; index <= MAX_SUBSCRIPTIONS; index += 1) await store.save(device(`https://fcm.googleapis.com/${index}`))
    expect(store.subscriptions).toHaveLength(MAX_SUBSCRIPTIONS)
    expect(store.subscriptions[0].endpoint).toBe('https://fcm.googleapis.com/1')
  })

  it('forgets devices, and writes nothing for ones it doesn’t know', async () => {
    const store = new PushStore(dir)
    await store.save(device('https://fcm.googleapis.com/a'))
    const before = await store.load()
    expect(await store.forget(['https://fcm.googleapis.com/unknown'])).toBe(before)
    await store.forget(['https://fcm.googleapis.com/a'])
    expect(store.subscriptions).toEqual([])
  })
})

describe('pushPayload', () => {
  it('cuts a body too long for a push, keeping the rest', () => {
    const payload = { title: 'Download finished', body: 'x'.repeat(10_000), url: '/torrent/a', tag: 'a' }
    const encoded = pushPayload(payload)
    expect(encoded.length).toBeLessThanOrEqual(MAX_PAYLOAD)
    const read = JSON.parse(encoded.toString())
    expect(read).toMatchObject({ title: 'Download finished', url: '/torrent/a', tag: 'a' })
    expect(read.body).toMatch(/^x+…$/)
    expect(read.body.length).toBeGreaterThan(MAX_PAYLOAD / 2)
  })

  it('leaves one that fits as it is', () => {
    const payload = { title: 'Download finished', body: 'Dune (2021)\nDune.2021.2160p.WEB-DL-GRPA', url: '/torrent/a', tag: 'a' }
    expect(JSON.parse(pushPayload(payload).toString())).toEqual(payload)
  })

  it('leaves one that fills a push to the byte as it is', () => {
    const empty = { title: 'Download finished', body: '', url: '/torrent/a', tag: 'a' }
    const payload = { ...empty, body: 'x'.repeat(MAX_PAYLOAD - JSON.stringify(empty).length) }
    expect(pushPayload(payload)).toEqual(Buffer.from(JSON.stringify(payload)))
    expect(pushPayload(payload).length).toBe(MAX_PAYLOAD)
  })
})

describe('testPayload', () => {
  it('says notifications are on, in the device’s language, and opens Settings', () => {
    expect(testPayload('ru')).toEqual({
      title: 'Kinopeer',
      body: 'Уведомления на этом устройстве включены. Когда загрузка завершится, придёт уведомление.',
      url: '/settings',
      tag: 'kinopeer-test',
    })
  })
})

describe('pushMiddleware', () => {
  const SETTINGS = { notifications: true } as ServerSettings

  async function setUp(send?: Parameters<typeof pushMiddleware>[0]['send']) {
    const service = await fakePushService()
    const store = new PushStore(dir)
    const origin = await serve(pushMiddleware({ store, settings: async () => SETTINGS, testOrigin: service.origin, send }))
    const call = (method: string, path: string, body?: unknown, contentType = 'application/json') =>
      fetch(`${origin}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': contentType },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      })
    return { service, store, call, origin }
  }

  it('answers the server’s public key, made on the first ask', async () => {
    const { store, call } = await setUp()
    const response = await call('GET', '/api/push/key')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ publicKey: vapidPublicKey(await store.vapidKey()) })
  })

  it('saves a device in its language and answers the settings', async () => {
    const { service, store, call } = await setUp()
    const target = service.subscribe('/send/a')
    const response = await call('PUT', '/api/push/subscription', { ...target, language: 'ru' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(SETTINGS)
    expect(store.subscriptions).toEqual([{ ...target, language: 'ru', added: expect.any(Number) }])
  })

  it('saves a new device in its own language beside the others', async () => {
    const { service, store, call } = await setUp()
    await call('PUT', '/api/push/subscription', { ...service.subscribe('/send/a'), language: 'ru' })
    await call('PUT', '/api/push/subscription', { ...service.subscribe('/send/b'), language: 'en' })
    expect(store.subscriptions.map(({ language }) => language)).toEqual(['ru', 'en'])
  })

  it('takes a renewed subscription in place of the old one, in its language', async () => {
    const { service, store, call } = await setUp()
    const old = service.subscribe('/send/old')
    await call('PUT', '/api/push/subscription', { ...old, language: 'ru' })
    const renewed = service.subscribe('/send/new')
    expect((await call('PUT', '/api/push/subscription', { ...renewed, language: 'en', replaces: old.endpoint })).status).toBe(200)
    expect(store.subscriptions).toEqual([{ ...renewed, language: 'ru', added: expect.any(Number) }])
  })

  it.each([
    ['no language', {}],
    ['no language, replacing a device the server doesn’t know', { replaces: 'https://fcm.googleapis.com/unknown' }],
    ['a language the server doesn’t write in', { language: 'de' }],
    ['a key that isn’t base64url', { language: 'en', p256dh: `${'A'.repeat(86)}!` }],
    ['a key that isn’t text', { language: 'en', p256dh: ['A'.repeat(87)] }],
    ['an authentication secret that isn’t text', { language: 'en', auth: ['A'.repeat(22)] }],
    ['no authentication secret', { language: 'en', auth: undefined }],
    ['a replaced endpoint that isn’t text', { language: 'en', replaces: 42 }],
    ['a key that isn’t a point of P-256', { language: 'en', p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url') }],
    ['an authentication secret that isn’t 16 bytes', { language: 'en', auth: Buffer.alloc(17, 1).toString('base64url') }],
  ])('refuses a device with %s', async (_name, change) => {
    const { service, store, call } = await setUp()
    const response = await call('PUT', '/api/push/subscription', { ...service.subscribe('/send/a'), ...change })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'bad-request' })
    expect(store.subscriptions).toEqual([])
  })

  it.each([
    ['an address on the server’s network', 'http://192.168.1.10:8080/api/v2/app/shutdown'],
    ['a push service it doesn’t know', 'https://push.example.org/send/a'],
  ])('refuses %s as a push service', async (_name, endpoint) => {
    const { service, store, call } = await setUp()
    const response = await call('PUT', '/api/push/subscription', { ...service.subscribe('/send/a'), endpoint, language: 'en' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid-endpoint' })
    expect(store.subscriptions).toEqual([])
  })

  it('forgets a device and answers the settings', async () => {
    const { service, store, call } = await setUp()
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    const response = await call('DELETE', '/api/push/subscription', { endpoint: target.endpoint })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(SETTINGS)
    expect(store.subscriptions).toEqual([])
  })

  it('sends a test notification to the device that asks, in its language', async () => {
    const { service, call } = await setUp()
    await call('PUT', '/api/push/subscription', { ...service.subscribe('/send/other'), language: 'en' })
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'ru' })
    const response = await call('POST', '/api/push/test', { endpoint: target.endpoint })
    expect(response.status).toBe(204)
    expect(service.pushes.map(({ path, payload }) => ({ path, payload }))).toEqual([{ path: '/send/a', payload: testPayload('ru') }])
  })

  it('says the server doesn’t know a device it was asked to test', async () => {
    const { service, call } = await setUp()
    const response = await call('POST', '/api/push/test', { endpoint: service.subscribe('/send/a').endpoint })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'unknown-device' })
    expect(service.pushes).toEqual([])
  })

  it('forgets a device whose subscription the push service says is gone', async () => {
    const { service, store, call } = await setUp()
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    service.answers['/send/a'] = { status: 410 }
    const response = await call('POST', '/api/push/test', { endpoint: target.endpoint })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'gone' })
    expect(store.subscriptions).toEqual([])
  })

  it('says the subscription is gone even when push.json can’t be written to forget it', async () => {
    const { service, store, call } = await setUp()
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    service.answers['/send/a'] = { status: 410 }
    vi.spyOn(store, 'forget').mockRejectedValue(new Error('read-only file system'))
    const response = await call('POST', '/api/push/test', { endpoint: target.endpoint })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'gone' })
  })

  it.each([
    [403, 502, 'refused'],
    [503, 503, 'unreachable'],
  ])('a push service answering %i: %i %s, keeping the device', async (status, answer, error) => {
    const { service, store, call } = await setUp()
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    service.answers['/send/a'] = { status }
    const response = await call('POST', '/api/push/test', { endpoint: target.endpoint })
    expect(response.status).toBe(answer)
    expect(await response.json()).toEqual({ error })
    expect(store.subscriptions).toHaveLength(1)
  })

  it('answers 500 for an error that isn’t the push service’s', async () => {
    const { service, call } = await setUp(async () => Promise.reject(new TypeError('bug')))
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    expect((await call('POST', '/api/push/test', { endpoint: target.endpoint })).status).toBe(500)
  })

  it('answers 503 when the push service didn’t answer in time', async () => {
    const { service, call } = await setUp(async () => Promise.reject(new PushUnavailable()))
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    expect((await call('POST', '/api/push/test', { endpoint: target.endpoint })).status).toBe(503)
  })

  it.each([
    ['a body that isn’t JSON', 'PUT', '/api/push/subscription', 'not json', 'application/json', 400],
    ['a body that’s a list', 'DELETE', '/api/push/subscription', [], 'application/json', 400],
    ['a body that’s null', 'PUT', '/api/push/subscription', 'null', 'application/json', 400],
    ['a test whose body is null', 'POST', '/api/push/test', 'null', 'application/json', 400],
    ['a test without an endpoint', 'POST', '/api/push/test', {}, 'application/json', 400],
    ['a form, which another site could send', 'PUT', '/api/push/subscription', 'endpoint=x', 'application/x-www-form-urlencoded', 415],
  ])('refuses %s', async (_name, method, path, body, contentType, status) => {
    const { call } = await setUp()
    expect((await call(method, path, body, contentType)).status).toBe(status)
  })

  it('answers a path under /api/push it doesn’t have itself, rather than passing it on', async () => {
    const { call } = await setUp()
    for (const path of ['/api/push/subscription', '/api/push']) {
      const response = await call('GET', path)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not-found' })
    }
  })

  it('gives the test notification up once the browser stops waiting for it', async () => {
    let signal: AbortSignal | undefined
    const send = vi.fn<NonNullable<Parameters<typeof pushMiddleware>[0]['send']>>(async (_target, _payload, _key, options) => {
      signal = options?.signal
      return new Promise(() => {})
    })
    const { service, call, origin } = await setUp(send)
    const target = service.subscribe('/send/a')
    await call('PUT', '/api/push/subscription', { ...target, language: 'en' })
    const leaving = new AbortController()
    void fetch(`${origin}/api/push/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: target.endpoint }),
      signal: leaving.signal,
    }).catch(() => undefined)
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(signal?.aborted).toBe(false)
    leaving.abort()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  })

  it('passes on paths outside /api/push', async () => {
    const { call } = await setUp()
    const response = await call('GET', '/api/pushes')
    expect(await response.text()).toBe('fallback')
  })

  it('answers 500 when push.json can’t be written, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await fakePushService()
    // A file where the data directory should be.
    await writeFile(join(dir, 'data'), '')
    const store = new PushStore(join(dir, 'data'))
    const origin = await serve(pushMiddleware({ store, settings: async () => SETTINGS, testOrigin: service.origin }))
    const key = await fetch(`${origin}/api/push/key`)
    expect(key.status).toBe(500)
    const saved = await fetch(`${origin}/api/push/subscription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...service.subscribe('/send/a'), language: 'en' }),
    })
    expect(saved.status).toBe(500)
    expect(await saved.json()).toEqual({ error: 'storage' })
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not write push.json; is the data directory writable?')
  })
})
