import { onProxySignIn } from '../api/fetchKinopeer'
import { PROXY_SIGN_IN_PARAM } from './swRoutes'

/**
 * Signing in again to a proxy in front of Kinopeer, such as Umbrel's app_proxy: it signs the
 * browser in with a cookie of its own and, once that lapses, answers every request with a redirect
 * to its sign-in page on another origin. Only a page load can follow it, and over HTTPS the service
 * worker answers the app's own page loads from its cache, so they never reach the proxy. So when a
 * request comes back redirected (src/api/fetchKinopeer.ts), the app loads the screen it's on again
 * with PROXY_SIGN_IN_PARAM, which the service worker leaves to the network (src/pwa/swRoutes.ts):
 * the proxy renews its cookie, or shows its sign-in first, and sends the browser back to that
 * address, where the app takes the parameter away.
 */

/**
 * How long after one sign-in another isn't tried: a sign-in closed without signing in leaves the
 * page where it was, whose next poll would open it again at once.
 */
export const SIGN_IN_RETRY_MS = 60_000

const SIGNED_IN_AT_KEY = 'kinopeer.proxySignInAt'

type Navigation = Pick<Location, 'href' | 'replace'>

/** Loads the current screen through the proxy, at most once per SIGN_IN_RETRY_MS. */
export function signInThroughProxy(location: Navigation, now = Date.now()): void {
  try {
    const since = now - Number(sessionStorage.getItem(SIGNED_IN_AT_KEY))
    // A stamp later than now is stale: the clock was set back since, and would hold it off till then.
    if (since >= 0 && since < SIGN_IN_RETRY_MS) return
    sessionStorage.setItem(SIGNED_IN_AT_KEY, String(now))
  } catch {
    // Without the storage nothing would stop a loop: the requests fail as before.
    return
  }
  loadPastTheShell(location)
}

/**
 * Loads the current screen again from the network, past the service worker, which answers the
 * app's own page loads from its cache: so a proxy in front can sign the browser in, and the browser
 * can ask about a certificate it no longer trusts (Umbrel renews its own every month, and a
 * per-site exception covers the old one only, #311). The user's "Open again", which nothing else
 * gets past and which the app offers only where it may help (`useMayOpenAgain`): with no answer
 * from Kinopeer's server at all, online, under a service worker. Umbrel down while the device is
 * online is left, where it ends on the browser's error page; SPEC's decision log weighs that.
 */
export function loadPastTheShell(location: Navigation = window.location): void {
  const url = new URL(location.href)
  url.searchParams.set(PROXY_SIGN_IN_PARAM, '1')
  // Replaced, not added: Back doesn't come to the address with the parameter.
  location.replace(url.href)
}

/**
 * Takes the parameter out of the address the proxy sent the app back to, before the app routes
 * it, and signs in through the proxy whenever a request is redirected from now on. Except on the
 * way back from a sign-in, until a request is answered without a redirect: a redirect then means
 * the proxy's cookie didn't stick, and signing in again would only load the page over and over.
 */
export function startProxySignIn(location: Navigation = window.location): void {
  const url = new URL(location.href)
  let backFromSignIn = url.searchParams.has(PROXY_SIGN_IN_PARAM)
  if (backFromSignIn) {
    url.searchParams.delete(PROXY_SIGN_IN_PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  onProxySignIn({
    signIn: () => {
      if (!backFromSignIn) signInThroughProxy(location)
    },
    answered: () => {
      backFromSignIn = false
    },
  })
}
