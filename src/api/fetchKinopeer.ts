import { setSignInNeed } from './auth/signInNeed'
import type { SignInNeed } from './auth/types'

/** A proxy in front of Kinopeer redirected the request to its sign-in. */
export class ProxySignInError extends Error {
  constructor() {
    super('A proxy in front of Kinopeer asks to sign in')
    this.name = 'ProxySignInError'
  }
}

/** Kinopeer's own login held the request back: the browser needs to sign in, or to set the password. */
export class SignInRequiredError extends Error {
  readonly need: SignInNeed

  constructor(need: SignInNeed) {
    super(`Kinopeer asks to ${need}`)
    this.name = 'SignInRequiredError'
    this.need = need
  }
}

/** On the 401 of Kinopeer's own login: what the browser needs (`AUTH_HEADER` in server/auth.ts). */
export const AUTH_HEADER = 'x-kinopeer-auth'

/** What fetchKinopeer tells the page about a proxy in front of Kinopeer. */
export interface ProxySignInHandlers {
  /** A request was redirected to the proxy's sign-in. */
  signIn: () => void
  /** A request was answered without a redirect: whatever sign-in there was worked. */
  answered: () => void
}

let handlers: ProxySignInHandlers = { signIn: () => {}, answered: () => {} }

/**
 * What to do when a proxy in front of Kinopeer asks to sign in: the app loads the page through it
 * (startProxySignIn in src/pwa/proxySignIn.ts). Kept apart from the page, so these clients run
 * without a DOM too (the server's integration tests). Without it the request only fails.
 */
export function onProxySignIn(next: ProxySignInHandlers): void {
  handlers = next
}

/**
 * fetch for Kinopeer's own routes. They send the cookies, because a proxy in front of Kinopeer
 * (Umbrel's app_proxy) signs the browser in with one, and they don't follow redirects: Kinopeer's
 * routes never answer with one, so a redirect is that proxy sending the request to its sign-in on
 * another origin, which a fetch can't follow (the CSP blocks it, and the sign-in is a page). That
 * holds while the only proxy in front is Umbrel's: one that redirects for anything else (a trailing
 * slash, a rewritten path, as a reverse proxy in front of plain Docker might) would fail every call
 * after loading the screen once through it, and then a redirect to the same origin needs following.
 *
 * A request Kinopeer's own login holds back (server/auth.ts) fails with SignInRequiredError and sets
 * the page's `signInNeed`, so the app shows its sign-in in place of the screen that sent it.
 */
export async function fetchKinopeer(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', redirect: 'manual' })
  if (response.type === 'opaqueredirect') {
    handlers.signIn()
    throw new ProxySignInError()
  }
  handlers.answered()
  const need = response.status === 401 ? response.headers.get(AUTH_HEADER) : null
  if (need === 'sign-in' || need === 'set-up') {
    setSignInNeed(need)
    throw new SignInRequiredError(need)
  }
  return response
}
