import { useSyncExternalStore } from 'react'
import type { Unreachable } from '../api/qbittorrent'

/** The i18next context of a text that says who didn't answer: `kinopeer` either way it was Kinopeer's server. */
export function unreachableText(who: Unreachable | undefined): 'kinopeer' | undefined {
  return who === 'unreached' || who === 'kinopeer' ? 'kinopeer' : undefined
}

/** The device going online or offline, and a service worker taking the page (`clientsClaim` after the first install). */
function subscribeToReach(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  navigator.serviceWorker?.addEventListener('controllerchange', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
    navigator.serviceWorker?.removeEventListener('controllerchange', onChange)
  }
}

const pastTheShellHelps = () => navigator.onLine && Boolean(navigator.serviceWorker?.controller)

/**
 * Whether to offer Open again (`loadPastTheShell`): nothing answered for Kinopeer's server while
 * the device is online and a service worker answers this page, where a page load past it shows
 * what the browser waits on, a certificate it no longer trusts or a sign-in (#311). Without a
 * service worker (plain HTTP) every page load goes to the network already and there's no
 * certificate. Not offline, where it would only swap the app's offline screen for the browser's
 * error page, nor when something answered for the server (Umbrel restarting the app), whose
 * certificate and sign-in are fine. Follows the device going online and offline and a service worker
 * taking the page.
 */
export function useMayOpenAgain(who: Unreachable | undefined): boolean {
  const helps = useSyncExternalStore(subscribeToReach, pastTheShellHelps)
  return who === 'unreached' && helps
}
