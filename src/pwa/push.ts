import { forgetPushSubscription, getPushKey, savePushSubscription } from '../api/push/client'
import type { NotifyLanguage } from '../api/settings/types'
import { getInstallMethod } from './install'
import { subscriptionBody } from './swPush'

/**
 * Whether this device can get push notifications, and whether it does. Read from the browser alone,
 * with no request: Settings asks the server nothing about push until it's turned on or tested.
 * - `insecure`: the page isn't over HTTPS (or a certificate the browser trusts), so it has no Push API.
 * - `install`: an iPhone or iPad, where only Kinopeer added to the Home Screen gets push.
 * - `unsupported`: a browser without the Push API or notifications.
 * - `no-worker`: no service worker runs the app, which push needs (the dev server; a certificate it
 *   wouldn't register under).
 * - `denied`: notifications are blocked for Kinopeer in the browser's settings.
 * - `off` / `on`: this device doesn't get them, or does, through `endpoint`.
 */
export type PushState =
  | { kind: 'insecure' | 'install' | 'unsupported' | 'no-worker' | 'denied' | 'off' }
  | { kind: 'on'; endpoint: string }

export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return { kind: 'insecure' }
  const supported = 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator
  // Safari on iPhone and iPad has the Push API only in the Home Screen app.
  if (!supported) return { kind: getInstallMethod() === 'ios' ? 'install' : 'unsupported' }
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return { kind: 'no-worker' }
  if (Notification.permission === 'denied') return { kind: 'denied' }
  const subscription = Notification.permission === 'granted' ? await registration.pushManager.getSubscription() : null
  return subscription ? { kind: 'on', endpoint: subscription.endpoint } : { kind: 'off' }
}

const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((byte, index) => byte === b[index])

/**
 * Turns notifications on for this device: asks for the permission (in the tap, as Safari requires),
 * subscribes with the server's key and saves the subscription on the server. Resolves the new
 * state, `denied` or `off` when the permission wasn't given; rejects when the browser or the server
 * failed.
 */
export async function turnOnPush(language: NotifyLanguage): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { kind: permission === 'denied' ? 'denied' : 'off' }
  const [registration, publicKey] = await Promise.all([navigator.serviceWorker.ready, getPushKey()])
  const key = keyBytes(publicKey)
  const existing = await registration.pushManager.getSubscription()
  // One made for another key (the server's push.json was lost) can't be reused.
  if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe()
  const subscription =
    existing && sameKey(existing.options.applicationServerKey, key)
      ? existing
      : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await savePushSubscription(subscriptionBody(subscription, language))
  return { kind: 'on', endpoint: subscription.endpoint }
}

/** Turns notifications off for this device: the server forgets it first, then the browser drops it. */
export async function turnOffPush(endpoint: string): Promise<PushState> {
  await forgetPushSubscription(endpoint)
  const registration = await navigator.serviceWorker.getRegistration()
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
  return { kind: 'off' }
}
