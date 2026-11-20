import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PushError } from '../api/push/client'
import { SERVER_SETTINGS_KEY } from '../api/settings/client'
import { sharedRequests } from '../logic/sharedRequests'
import { pushState, turnOffPush, turnOnPush } from './push'

const SERVER_KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => object
  unsubscribe: Mock<() => Promise<boolean>>
}

const subscriptionWith = (endpoint: string, key: Uint8Array): FakeSubscription => ({
  endpoint,
  options: { applicationServerKey: key.slice().buffer },
  toJSON: () => ({ endpoint, keys: { p256dh: 'device-key', auth: 'device-secret' } }),
  unsubscribe: vi.fn(async () => true),
})

let fetchMock: Mock<typeof fetch>
let browser: ReturnType<typeof stubBrowser>

/** A browser with the Push API, its service worker registered, and the permission and subscription given. */
function stubBrowser({ permission = 'default' as NotificationPermission, subscription = null as FakeSubscription | null } = {}) {
  const state = { permission, subscription, answer: 'granted' as NotificationPermission }
  const pushManager = {
    getSubscription: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      state.subscription = subscriptionWith('https://fcm.googleapis.com/fcm/send/new', applicationServerKey)
      return state.subscription
    }),
  }
  const registration = { pushManager }
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', {
    get permission() {
      return state.permission
    },
    requestPermission: vi.fn(async () => (state.permission = state.answer)),
  })
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    maxTouchPoints: 0,
    serviceWorker: { getRegistration: vi.fn(async () => registration), ready: Promise.resolve(registration) },
  })
  return { state, pushManager, registration }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  browser = stubBrowser()
})

describe('pushState', () => {
  it('is insecure over plain HTTP', async () => {
    vi.stubGlobal('isSecureContext', false)
    expect(await pushState()).toEqual({ kind: 'insecure' })
  })

  it('asks for the Home Screen on an iPhone without the Push API', async () => {
    vi.stubGlobal('PushManager', undefined)
    Reflect.deleteProperty(window, 'PushManager')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 })
    expect(await pushState()).toEqual({ kind: 'install' })
  })

  it('is unsupported elsewhere without the Push API', async () => {
    Reflect.deleteProperty(window, 'PushManager')
    expect(await pushState()).toEqual({ kind: 'unsupported' })
  })

  it('says no worker runs the app when none is registered', async () => {
    vi.mocked(navigator.serviceWorker.getRegistration).mockResolvedValue(undefined)
    expect(await pushState()).toEqual({ kind: 'no-worker' })
  })

  it('says notifications are blocked', async () => {
    browser.state.permission = 'denied'
    expect(await pushState()).toEqual({ kind: 'denied' })
  })

  it('is off without the permission, without asking for the subscription', async () => {
    expect(await pushState()).toEqual({ kind: 'off' })
    expect(browser.pushManager.getSubscription).not.toHaveBeenCalled()
  })

  it('is off with the permission and no subscription, and on with one', async () => {
    browser.state.permission = 'granted'
    expect(await pushState()).toEqual({ kind: 'off' })
    browser.state.subscription = subscriptionWith('https://fcm.googleapis.com/fcm/send/a', keyBytes(SERVER_KEY))
    expect(await pushState()).toEqual({ kind: 'on', endpoint: 'https://fcm.googleapis.com/fcm/send/a' })
  })

  it('asks the server nothing', async () => {
    await pushState()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('turnOnPush', () => {
  const settings = { notifications: true, push: { devices: 1 } }

  it('asks for the permission, subscribes with the server’s key and saves the device in its language', async () => {
    fetchMock.mockResolvedValueOnce(json({ publicKey: SERVER_KEY })).mockResolvedValueOnce(json(settings))
    expect(await turnOnPush('ru')).toEqual({ kind: 'on', endpoint: 'https://fcm.googleapis.com/fcm/send/new' })
    expect(Notification.requestPermission).toHaveBeenCalled()
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes(SERVER_KEY) })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/push/key', 'GET'],
      ['/api/push/subscription', 'PUT'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      p256dh: 'device-key',
      auth: 'device-secret',
      language: 'ru',
    })
    expect(sharedRequests.peek(SERVER_SETTINGS_KEY, Infinity)?.data).toEqual(settings)
  })

  it.each([
    ['denied', { kind: 'denied' }],
    ['default', { kind: 'off' }],
  ] as const)('stops when the permission is %s, asking the server nothing', async (answer, state) => {
    browser.state.answer = answer
    expect(await turnOnPush('en')).toEqual(state)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves a subscription the browser has for the same key again, without subscribing', async () => {
    browser.state.subscription = subscriptionWith('https://fcm.googleapis.com/fcm/send/kept', keyBytes(SERVER_KEY))
    fetchMock.mockResolvedValueOnce(json({ publicKey: SERVER_KEY })).mockResolvedValueOnce(json(settings))
    expect(await turnOnPush('en')).toEqual({ kind: 'on', endpoint: 'https://fcm.googleapis.com/fcm/send/kept' })
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('drops a subscription made for another key and subscribes anew', async () => {
    const old = subscriptionWith('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2]))
    browser.state.subscription = old
    fetchMock.mockResolvedValueOnce(json({ publicKey: SERVER_KEY })).mockResolvedValueOnce(json(settings))
    expect(await turnOnPush('en')).toEqual({ kind: 'on', endpoint: 'https://fcm.googleapis.com/fcm/send/new' })
    expect(old.unsubscribe).toHaveBeenCalled()
  })

  it.each([
    ['of the same length, a byte apart', () => keyBytes(SERVER_KEY).map((byte, index) => (index === 64 ? byte ^ 1 : byte))],
    ['that starts as the server’s and is shorter', () => keyBytes(SERVER_KEY).slice(0, 33)],
    ['that the browser doesn’t give', () => null],
  ])('drops a subscription with a key %s and subscribes anew', async (_name, key) => {
    const old = { ...subscriptionWith('https://fcm.googleapis.com/fcm/send/old', new Uint8Array()), options: { applicationServerKey: key()?.slice().buffer ?? null } }
    browser.state.subscription = old
    fetchMock.mockResolvedValueOnce(json({ publicKey: SERVER_KEY })).mockResolvedValueOnce(json(settings))
    expect(await turnOnPush('en')).toEqual({ kind: 'on', endpoint: 'https://fcm.googleapis.com/fcm/send/new' })
    expect(old.unsubscribe).toHaveBeenCalled()
  })

  it('rejects with the server’s refusal', async () => {
    fetchMock.mockResolvedValueOnce(json({ publicKey: SERVER_KEY })).mockResolvedValueOnce(json({ error: 'invalid-endpoint' }, 400))
    const error = await turnOnPush('en').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PushError)
    expect(error).toMatchObject({ status: 400, code: 'invalid-endpoint' })
  })
})

describe('turnOffPush', () => {
  it('has the server forget the device, then drops the browser’s subscription', async () => {
    const subscription = subscriptionWith('https://fcm.googleapis.com/fcm/send/a', keyBytes(SERVER_KEY))
    browser.state.subscription = subscription
    fetchMock.mockResolvedValueOnce(json({ notifications: false }))
    expect(await turnOffPush(subscription.endpoint)).toEqual({ kind: 'off' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/push/subscription')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) })
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(sharedRequests.peek(SERVER_SETTINGS_KEY, Infinity)?.data).toEqual({ notifications: false })
  })

  it('keeps the subscription when the server didn’t forget the device', async () => {
    const subscription = subscriptionWith('https://fcm.googleapis.com/fcm/send/a', keyBytes(SERVER_KEY))
    browser.state.subscription = subscription
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(turnOffPush(subscription.endpoint)).rejects.toBeInstanceOf(PushError)
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })
})
