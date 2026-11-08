/** A proxy in front of Kinopeer redirected the request to its sign-in. */
export class ProxySignInError extends Error {
  constructor() {
    super('A proxy in front of Kinopeer asks to sign in')
    this.name = 'ProxySignInError'
  }
}

let signIn: () => void = () => {}

/**
 * What to do when a proxy in front of Kinopeer asks to sign in: the app loads the page through it
 * (startProxySignIn in src/pwa/proxySignIn.ts). Kept apart from the page, so these clients run
 * without a DOM too (the server's integration tests). Without it the request only fails.
 */
export function onProxySignIn(handler: () => void): void {
  signIn = handler
}

/**
 * fetch for Kinopeer's own routes. They send the cookies, because a proxy in front of Kinopeer
 * (Umbrel's app_proxy) signs the browser in with one, and they don't follow redirects: Kinopeer's
 * routes never answer with one, so a redirect is that proxy sending the request to its sign-in on
 * another origin, which a fetch can't follow (the CSP blocks it, and the sign-in is a page). That
 * holds while the only proxy in front is Umbrel's: one that redirects for anything else (a trailing
 * slash, a rewritten path, as a reverse proxy in front of plain Docker might) would fail every call
 * and load the screen again once a minute, and then a redirect to the same origin needs following.
 */
export async function fetchKinopeer(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', redirect: 'manual' })
  if (response.type === 'opaqueredirect') {
    signIn()
    throw new ProxySignInError()
  }
  return response
}
