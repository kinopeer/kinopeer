import { useSyncExternalStore } from 'react'
import type { Unreachable } from '../api/qbittorrent'

/** The i18next context of a text that says who didn't answer: `kinopeer` either way it was Kinopeer's server. */
export function unreachableText(who: Unreachable | undefined): 'kinopeer' | undefined {
  return who === 'unreached' || who === 'kinopeer' ? 'kinopeer' : undefined
}

function subscribeToOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * Whether to offer Open again (`loadPastTheShell`): nothing answered for Kinopeer's server while
 * the device is online and a service worker answers this page, where a page load past it shows
 * what the browser waits on, a certificate it no longer trusts or a sign-in (#311). Without a
 * service worker (plain HTTP) every page load goes to the network already and there's no
 * certificate. Not offline, where it would only swap the app's offline screen for the browser's
 * error page, nor when something answered for the server (Umbrel restarting the app), whose
 * certificate and sign-in are fine. Follows the device going online and offline.
 */
export function useMayOpenAgain(who: Unreachable | undefined): boolean {
  const online = useSyncExternalStore(subscribeToOnline, () => navigator.onLine)
  return who === 'unreached' && online && Boolean(navigator.serviceWorker?.controller)
}
