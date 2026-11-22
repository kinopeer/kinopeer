// Whether a page is on a private network, by its origin. One rule for the TMDB proxy, which gives CORS
// headers only to such a page (tmdb-proxy/worker.ts), and for the WebUI build, which uses the proxy
// only where it would answer the page (src/api/settings/webui.ts).

/** Suffixes of names public DNS never answers for (RFC 6761, 6762, 8375; `.internal`, ICANN, 2024). */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.home.arpa', '.internal']

/** Whether `address`, an IPv4 address in dotted decimal, is private, loopback, link-local or CGNAT. */
function isPrivateIpv4(address: string): boolean {
  // Four numbers, as the caller's pattern holds; the defaults only satisfy the type.
  const [a = -1, b = -1] = address.split('.').map(Number)
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // link-local
    (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10, carrier-grade NAT's and Tailscale's
  )
}

/**
 * Whether `address`, an IPv6 address as the URL parser writes it (compressed, lowercase, without
 * brackets), is loopback, unique local (fc00::/7) or link-local (fe80::/10). An IPv4-mapped address
 * (`::ffff:c0a8:101`) isn't read: no browser opens a page at one, so it says nothing.
 */
function isPrivateIpv6(address: string): boolean {
  if (address === '::1') return true
  // An address that starts with `::` has an empty first group, read as NaN, whose bits are none.
  const first = Number.parseInt(address.split(':')[0] ?? '', 16)
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}

/**
 * Whether a page at `origin` (a request's `Origin` header) is on a private network: an http(s)
 * origin whose host is an IP address in a private, loopback, link-local or CGNAT range, `localhost`
 * or a name under `.localhost`, `.local`, `.home.arpa` or `.internal`, or a name of one label (a LAN
 * name). Anything else, `null` (a sandboxed page, a file) included, is public.
 *
 * Not server/hostCheck.ts's `isPrivateHost`, which counts every IP address as private: that check is
 * against DNS rebinding, where a page reached at an IP address can't be an attacker's name. Here the
 * question is whose page it is, and a public IP address is someone's public site.
 */
export function isPrivateOrigin(origin: string | null): boolean {
  let url: URL
  try {
    // No Origin, `null` and an empty one don't parse.
    url = new URL(origin ?? '')
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // A fully qualified name's trailing dot names the same host.
  const host = url.hostname.replace(/\.$/, '')
  if (host.startsWith('[')) return isPrivateIpv6(host.slice(1, -1))
  // The URL parser writes every IPv4 address in dotted decimal (0x7f.1 as 127.0.0.1).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host)
  // A name of one label, `localhost` among them; empty for an origin of a lone dot.
  if (!host.includes('.')) return host !== ''
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
