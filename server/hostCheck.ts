import type { IncomingHttpHeaders } from 'node:http'
import type { Middleware } from './prowlarr.ts'

/**
 * The host names Kinopeer's server answers at (#356). A page whose own host name an attacker
 * points at Kinopeer's address (DNS rebinding) is same-origin with it, so the browser lets it send
 * the `X-Kinopeer` header and read the answers; what tells it apart is the `Host` it sends, its own
 * name. So the server answers only for names such a page can't have: names no public DNS answers
 * for, which an attacker can't register (`isPrivateHost`), and the ones `KINOPEER_ALLOWED_HOSTS`
 * adds, such as a reverse proxy's domain.
 */
export interface AllowedHosts {
  /** `*`: every host name, for a server behind a sign-in proxy that does this already (Umbrel's). */
  any: boolean
  /** Names allowed as written. */
  names: string[]
  /** Domains whose names are allowed, each with its leading dot: `.example.com`. */
  domains: string[]
}

/**
 * Suffixes of names that public DNS never answers for: `localhost` (browsers resolve it themselves),
 * mDNS's `.local`, Tor's `.onion` (RFC 6761, 6762, 7686), `.home.arpa` for home networks (RFC 8375)
 * and `.internal`, which ICANN reserved for private use in 2024. Not `.lan`, `.home` or `.box`:
 * routers use them, but they aren't reserved, and `.box` is a public TLD.
 */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.onion', '.home.arpa', '.internal']

/**
 * Reads `KINOPEER_ALLOWED_HOSTS`: host names separated by commas or spaces, `.example.com` (or
 * `*.example.com`) for a domain and every name under it, `*` for any. A port or a trailing dot is
 * ignored, and a name in another script is taken in its ASCII form, as browsers send it. What isn't
 * a host name (a URL with a path, say) goes to `invalid`, and a domain of one label (`.lan`) to
 * `tooBroad`, both for a warning at startup.
 */
export function allowedHosts(value: string | undefined): { allowed: AllowedHosts; invalid: string[]; tooBroad: string[] } {
  const allowed: AllowedHosts = { any: false, names: [], domains: [] }
  const invalid: string[] = []
  const tooBroad: string[] = []
  for (const entry of (value ?? '').split(/[\s,]+/).filter(Boolean)) {
    if (entry === '*') {
      allowed.any = true
      continue
    }
    const domain = /^\*?\./.exec(entry)
    const name = hostName(domain ? entry.slice(domain[0].length) : entry)
    if (!name || name.startsWith('.') || name.includes('*')) invalid.push(entry)
    // A domain of one label (`.com`) would let in every name under a public suffix; one a router
    // uses (`.lan`) is listed name by name.
    else if (domain && !name.includes('.')) tooBroad.push(entry)
    else if (domain) allowed.domains.push(`.${name}`)
    else allowed.names.push(name)
  }
  return { allowed, invalid, tooBroad }
}

/** What the server warns about at startup: the entries of `KINOPEER_ALLOWED_HOSTS` it ignores, and why. */
export function allowedHostsWarning(value: string | undefined): string | undefined {
  const { invalid, tooBroad } = allowedHosts(value)
  const warnings = [
    invalid.length ? `not host names, ignored: ${invalid.join(', ')}` : '',
    tooBroad.length ? `domains of one label are too broad, ignored: ${tooBroad.map(tooBroadHint).join(', ')}` : '',
  ].filter(Boolean)
  return warnings.length ? `KINOPEER_ALLOWED_HOSTS: ${warnings.join('; ')}` : undefined
}

/** A too-broad entry with what to do instead: list its names, unless the check answers them by default. */
function tooBroadHint(entry: string): string {
  const label = entry.replace(/^\*?\./, '').toLowerCase()
  const example = `kinopeer.${label}`
  return isPrivateHost(example) ? `${entry} (its names are allowed already)` : `${entry} (list its names instead, such as ${example})`
}

/**
 * The host name a `Host` header (or an allowed entry) names, as the URL parser reads it: lowercase,
 * ASCII, an IPv4 address in its usual form, an IPv6 one in brackets, with no port or trailing dot.
 * Undefined for what isn't one alone, such as a value with a path or a login.
 */
export function hostName(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(`http://${value}`)
  } catch {
    return undefined
  }
  if (url.pathname !== '/' || url.username || url.password || url.search || url.hash) return undefined
  return url.hostname.replace(/\.$/, '') || undefined
}

/** Whether a page can have `name` (from `hostName`) only on the person's own machine or network. */
export function isPrivateHost(name: string): boolean {
  // An address isn't a name DNS can point elsewhere. The URL parser reads a name whose last label is
  // a number as an IPv4 address, so only an address has this form.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return true
  // A name of one label (`nas`, a Docker service's) only the network's own DNS answers for: public
  // DNS has no addresses for top-level domains. An IPv6 address in brackets has no dot either.
  if (!name.includes('.')) return true
  return PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/** Whether Kinopeer answers a request that names the host `value` (a `Host` header's value). */
export function isAllowedHost(value: string | undefined, allowed: AllowedHosts): boolean {
  if (allowed.any) return true
  const name = value === undefined ? undefined : hostName(value)
  if (!name) return false
  return isPrivateHost(name) || allowed.names.includes(name) || allowed.domains.some((domain) => `.${name}`.endsWith(domain))
}

/**
 * The first host a request names that Kinopeer doesn't answer at, or undefined when it answers it:
 * its `Host` and, when a proxy in front added one, each host in `X-Forwarded-Host`. The latter
 * can't let a request through that its `Host` doesn't, since every one must be allowed, while it
 * catches a proxy that sends the upstream's address as `Host` and the page's name in it. A proxy
 * that sends neither the page's `Host` nor `X-Forwarded-Host` (nginx's default) hides the name, and
 * the check sees only the upstream's, which it allows if the proxy works at all: there only the
 * proxy can refuse a rebound name (nginx: a catch-all `default_server` that returns 444).
 */
export function refusedHost(headers: IncomingHttpHeaders, allowed: AllowedHosts): string | undefined {
  const forwarded = String(headers['x-forwarded-host'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  const hosts = [headers.host, ...forwarded]
  for (const host of hosts) if (!isAllowedHost(host, allowed)) return host ?? ''
  return undefined
}

/**
 * Refuses a request for a host Kinopeer doesn't answer at with a 403 and a text a person who opened
 * Kinopeer at a name not allowed yet can act on; the rest goes on. After the security headers, so
 * the refusal carries them, and before every other route.
 */
export function hostCheck(allowed: AllowedHosts): Middleware {
  return (request, response, next) => {
    const host = refusedHost(request.headers, allowed)
    if (host === undefined) return next()
    // A host it can't read can't go into the variable either: the text for no host says what to set.
    const name = hostName(host) ?? ''
    response.statusCode = 403
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(refusal(name))
  }
}

/** The refusal's text, in English like the server's other answers: the app's translations aren't loaded here. */
export function refusal(name: string): string {
  return [
    name ? `Kinopeer doesn't answer at ${name}.` : "Kinopeer doesn't answer a request without a host name it can read.",
    '',
    "It answers only at the addresses it is meant to be reached at, so that another website can't reach it by pointing its own address at Kinopeer's (DNS rebinding).",
    '',
    `If you opened Kinopeer at this address yourself, add it to the KINOPEER_ALLOWED_HOSTS environment variable (KINOPEER_ALLOWED_HOSTS=${name || 'kinopeer.example.com'}) and restart Kinopeer.`,
    '',
  ].join('\n')
}
