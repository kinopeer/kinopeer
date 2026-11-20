/**
 * What the service worker (src/sw.ts) does with push: shows a notification the server sent
 * (server/pushChannel.ts), opens its page when it's tapped, and saves a subscription the browser
 * renewed. Kept apart from the worker's globals, with only the shapes it uses, so it's tested as
 * plain logic.
 */
import type { PushPayload, PushSubscriptionBody } from '../api/push/types'

/** The app's icon on the notification, and the monochrome one Android puts in the status bar. */
export const NOTIFICATION_ICON = '/icons/icon-192.png'
export const NOTIFICATION_BADGE = '/icons/icon-monochrome-512.png'

/** Where the service worker saves a renewed subscription (PUSH_BASE in src/api/push/client.ts). */
export const PUSH_SUBSCRIPTION_URL = '/api/push/subscription'

const isText = (value: unknown): value is string => typeof value === 'string'

/** Stands for the app's origin while a path is resolved: no address the app is opened at uses it. */
const APP_ORIGIN = 'https://app.invalid'

/**
 * A path of the app's, never another origin's: resolved as the browser would, so `//host`, `/\host`
 * and a tab or line break in between (`/\t/host`, which the URL parser drops) lead nowhere else.
 */
export function appPath(value: unknown): string {
  if (!isText(value) || !value.startsWith('/')) return '/'
  let url: URL
  try {
    url = new URL(value, APP_ORIGIN)
  } catch {
    // A value the URL parser refuses (`//[x`) is no path of the app's either. Not URL.canParse,
    // which Safari before 17 lacks, while push works on iOS from 16.4.
    return '/'
  }
  return url.origin === APP_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : '/'
}

/** The push's payload as the server sends it, or undefined for anything else. */
export function readPayload(data: { json: () => unknown } | null): PushPayload | undefined {
  let payload: unknown
  try {
    payload = data?.json()
  } catch {
    // Not JSON: read as no payload.
  }
  const { title, body, url, tag } = (payload ?? {}) as Partial<Record<keyof PushPayload, unknown>>
  return isText(title) && isText(body) ? { title, body, url: appPath(url), tag: isText(tag) ? tag : '' } : undefined
}

/** What the notification shows besides its title; the DOM's NotificationOptions, which the server's tests compile without. */
interface ShownNotification {
  body: string
  icon: string
  badge: string
  tag?: string
  data: { url: string }
}

interface Registration {
  showNotification: (title: string, options: ShownNotification) => Promise<void>
}

/**
 * Shows the push as a notification. Every push is shown, as browsers require of a subscription that's
 * `userVisibleOnly`: one this version can't read says only that it's from Kinopeer.
 */
export function showPush(registration: Registration, data: { json: () => unknown } | null): Promise<void> {
  const payload = readPayload(data) ?? { title: 'Kinopeer', body: '', url: '/', tag: '' }
  return registration.showNotification(payload.title, {
    body: payload.body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    // A push for the same torrent replaces the one before.
    ...(payload.tag && { tag: payload.tag }),
    data: { url: payload.url },
  })
}

interface WindowLike {
  url: string
  focus: () => Promise<unknown>
  navigate: (url: string) => Promise<unknown>
}

interface Clients {
  matchAll: (options: { type: 'window'; includeUncontrolled: boolean }) => Promise<readonly WindowLike[]>
  openWindow: (url: string) => Promise<unknown>
}

/**
 * Opens the notification's page: in a window of Kinopeer's that's open, brought to the front, else
 * in a new one. A window the service worker doesn't control (opened before it took over) can't be
 * taken to another page from here, so the page opens in a new one then.
 */
export async function openPush(clients: Clients, origin: string, data: unknown): Promise<void> {
  const url = new URL(appPath((data as { url?: unknown } | null)?.url), origin).href
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((window) => new URL(window.url).origin === origin)
  if (!open) {
    await clients.openWindow(url)
    return
  }
  await open.focus()
  if (open.url !== url) await open.navigate(url).catch(() => clients.openWindow(url))
}

/** The language a subscription renewed in the worker is saved with, when the server doesn't know the one it replaces. */
export function workerLanguage(languages: readonly string[]): PushSubscriptionBody['language'] {
  return languages.some((language) => language.toLowerCase().startsWith('ru')) ? 'ru' : 'en'
}

/** What the server is sent for a subscription: its endpoint and keys (`PushSubscription.toJSON()`). */
export function subscriptionBody(
  subscription: { toJSON: () => { endpoint?: string; keys?: Record<string, string> } },
  language: PushSubscriptionBody['language'],
  replaces?: string,
): PushSubscriptionBody {
  const { endpoint = '', keys = {} } = subscription.toJSON()
  return { endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '', language, ...(replaces && { replaces }) }
}

interface Subscription {
  endpoint: string
  options?: { applicationServerKey?: ArrayBuffer | null }
  toJSON: () => { endpoint?: string; keys?: Record<string, string> }
}

interface PushManagerLike {
  subscribe: (options: { userVisibleOnly: true; applicationServerKey: ArrayBuffer }) => Promise<Subscription>
}

/**
 * When the browser renews a subscription (`pushsubscriptionchange`), saves the new one on the server
 * in place of the old, subscribing again with the old one's key when the browser gave no new one.
 * Without either there's nothing to save: Settings then shows notifications off on this device.
 */
export async function renewPush(
  pushManager: PushManagerLike,
  old: Subscription | null,
  renewed: Subscription | null,
  languages: readonly string[],
  save: (body: PushSubscriptionBody) => Promise<unknown>,
): Promise<void> {
  const key = old?.options?.applicationServerKey
  const subscription = renewed ?? (key ? await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null)
  if (subscription) await save(subscriptionBody(subscription, workerLanguage(languages), old?.endpoint))
}
