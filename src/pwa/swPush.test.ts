import { describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_BADGE, NOTIFICATION_ICON, appPath, openPush, readPayload, renewPush, showPush, subscriptionBody, workerLanguage } from './swPush'

const data = (value: unknown) => ({ json: () => value })

describe('appPath', () => {
  it.each([
    ['a path of the app’s', '/torrent/abc', '/torrent/abc'],
    ['a path with a query', '/search?q=dune', '/search?q=dune'],
    ['a path with two slashes inside', '/torrent//abc', '/torrent//abc'],
    ['another origin', 'https://example.org/x', '/'],
    ['a path that leads to another host', '//example.org/x', '/'],
    ['one with a backslash that leads to another host', '/\\example.org/x', '/'],
    ['a relative path', 'torrent/abc', '/'],
    ['nothing', undefined, '/'],
  ])('%s: %s', (_name, value, path) => {
    expect(appPath(value)).toBe(path)
  })
})

describe('readPayload', () => {
  it('reads what the server sends', () => {
    expect(readPayload(data({ title: 'Download finished', body: 'Dune', url: '/torrent/a', tag: 'a' }))).toEqual({
      title: 'Download finished',
      body: 'Dune',
      url: '/torrent/a',
      tag: 'a',
    })
  })

  it('takes the app’s start page for a missing or foreign url, and no tag for a missing one', () => {
    expect(readPayload(data({ title: 'T', body: 'B', url: 'https://example.org' }))).toEqual({ title: 'T', body: 'B', url: '/', tag: '' })
  })

  it.each([
    ['no data', null],
    ['data that isn’t JSON', { json: () => JSON.parse('not json') }],
    ['no title', data({ body: 'B' })],
    ['a body that isn’t text', data({ title: 'T', body: 1 })],
    ['JSON that isn’t an object', data(null)],
  ])('nothing for %s', (_name, value) => {
    expect(readPayload(value as never)).toBeUndefined()
  })
})

describe('showPush', () => {
  it('shows the title and body with the app’s icons, tagged by the torrent, and keeps its page', async () => {
    const registration = { showNotification: vi.fn(async () => {}) }
    await showPush(registration, data({ title: 'Download finished', body: 'Dune', url: '/torrent/a', tag: 'a' }))
    expect(registration.showNotification).toHaveBeenCalledWith('Download finished', {
      body: 'Dune',
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: 'a',
      data: { url: '/torrent/a' },
    })
  })

  it('still shows one it can’t read, as from Kinopeer, without a tag', async () => {
    const registration = { showNotification: vi.fn(async () => {}) }
    await showPush(registration, null)
    expect(registration.showNotification).toHaveBeenCalledWith('Kinopeer', { body: '', icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE, data: { url: '/' } })
  })
})

describe('openPush', () => {
  const ORIGIN = 'https://kinopeer.local'
  const windowAt = (url: string) => ({ url, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) })
  const clientsWith = (...windows: ReturnType<typeof windowAt>[]) => ({ matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => {}) })

  it('opens a new window at the page when no window of Kinopeer’s is open', async () => {
    const other = windowAt('https://example.org/')
    const clients = clientsWith(other)
    await openPush(clients, ORIGIN, { url: '/torrent/a' })
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/torrent/a`)
    expect(other.focus).not.toHaveBeenCalled()
  })

  it('brings an open window of Kinopeer’s to the front and takes it to the page', async () => {
    const open = windowAt(`${ORIGIN}/search`)
    const clients = clientsWith(windowAt('https://example.org/'), open)
    await openPush(clients, ORIGIN, { url: '/torrent/a' })
    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(open.focus).toHaveBeenCalled()
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/torrent/a`)
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('leaves a window already on the page as it is', async () => {
    const open = windowAt(`${ORIGIN}/torrent/a`)
    await openPush(clientsWith(open), ORIGIN, { url: '/torrent/a' })
    expect(open.focus).toHaveBeenCalled()
    expect(open.navigate).not.toHaveBeenCalled()
  })

  it('opens the start page for a notification without a page of the app’s', async () => {
    const clients = clientsWith()
    await openPush(clients, ORIGIN, { url: '//example.org/' })
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`)
  })
})

describe('workerLanguage', () => {
  it.each([
    [['ru-RU', 'en'], 'ru'],
    [['en-US', 'ru'], 'ru'],
    [['RU'], 'ru'],
    [['ru-UA'], 'ru'],
    [['de-DE', 'en'], 'en'],
    [[], 'en'],
  ])('%j: %s', (languages, language) => {
    expect(workerLanguage(languages)).toBe(language)
  })
})

const subscription = (endpoint: string) => ({
  endpoint,
  options: { applicationServerKey: new Uint8Array([4, 1, 2]).buffer },
  toJSON: () => ({ endpoint, keys: { p256dh: `${endpoint}-key`, auth: `${endpoint}-secret` } }),
})

describe('subscriptionBody', () => {
  it('sends the endpoint, its keys and the language, and what it replaces when it does', () => {
    expect(subscriptionBody(subscription('a'), 'ru')).toEqual({ endpoint: 'a', p256dh: 'a-key', auth: 'a-secret', language: 'ru' })
    expect(subscriptionBody(subscription('b'), 'en', 'a')).toEqual({ endpoint: 'b', p256dh: 'b-key', auth: 'b-secret', language: 'en', replaces: 'a' })
  })

  it('sends empty keys for a subscription without them, which the server refuses', () => {
    expect(subscriptionBody({ toJSON: () => ({}) }, 'en')).toEqual({ endpoint: '', p256dh: '', auth: '', language: 'en' })
  })
})

describe('renewPush', () => {
  it('saves the subscription the browser renewed, in place of the old one', async () => {
    const pushManager = { subscribe: vi.fn() }
    const save = vi.fn(async () => {})
    await renewPush(pushManager, subscription('old'), subscription('new'), ['en'], save)
    expect(save).toHaveBeenCalledWith({ endpoint: 'new', p256dh: 'new-key', auth: 'new-secret', language: 'en', replaces: 'old' })
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('subscribes again with the old one’s key when the browser gave no new one', async () => {
    const old = subscription('old')
    const pushManager = { subscribe: vi.fn(async () => subscription('again')) }
    const save = vi.fn(async () => {})
    await renewPush(pushManager, old, null, ['ru'], save)
    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey })
    expect(save).toHaveBeenCalledWith({ endpoint: 'again', p256dh: 'again-key', auth: 'again-secret', language: 'ru', replaces: 'old' })
  })

  it('saves nothing without either', async () => {
    const save = vi.fn(async () => {})
    await renewPush({ subscribe: vi.fn() }, null, null, ['en'], save)
    await renewPush({ subscribe: vi.fn() }, { ...subscription('old'), options: {} }, null, ['en'], save)
    expect(save).not.toHaveBeenCalled()
  })
})
