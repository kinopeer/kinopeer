import type { Middleware } from './prowlarr.ts'

/**
 * Headers every answer of Kinopeer's server carries, the app's files and the bridges' alike: in
 * production (server/main.ts) and from the dev and preview servers, which run the same routes
 * (vite.config.ts). No Strict-Transport-Security: Kinopeer is opened over plain HTTP on the home
 * network as well as over umbrelOS's HTTPS, and a browser told to use HTTPS only would stop
 * opening it there.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Nothing is read as another type than it's sent as, a page passed on by a bridge included.
  'X-Content-Type-Options': 'nosniff',
  // No other site shows Kinopeer in a frame, to have its buttons clicked unseen. umbrelOS opens
  // apps in a tab of their own, not a frame.
  'X-Frame-Options': 'DENY',
  // A link out (an indexer's page, TMDB) doesn't tell the site Kinopeer's address.
  'Referrer-Policy': 'same-origin',
  // What Kinopeer never uses isn't there for a script to ask for.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // A page Kinopeer opens, or that opens Kinopeer, gets no hold on its window. Browsers apply it
  // over HTTPS only.
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Sets SECURITY_HEADERS on the answer, then hands the request on: the first of the server's routes. */
export const securityHeaders: Middleware = (_request, response, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value)
  next()
}
