/**
 * Service addresses: qBittorrent's and Prowlarr's, from the environment (QBITTORRENT_URL,
 * PROWLARR_URL) or saved from the app (server/settings.ts).
 */

/** An address as the bridges call it: trimmed and without trailing slashes; undefined when blank. */
export function baseOf(url: string | undefined): string | undefined {
  return url?.trim().replace(/\/+$/, '') || undefined
}

/** Longer than any service address, so a body can't make the server keep a huge string. */
const MAX_ADDRESS_LENGTH = 2048

/**
 * An address the app sent, as the server will call it, or undefined when it isn't one: http or
 * https only, with no login in it (the login has its own fields), no query and no fragment, which
 * the bridges' paths would be added after. A path is kept, for a service behind a reverse proxy.
 */
export function parseAddress(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH) return undefined
  let url: URL
  try {
    // The parser drops spaces around the address itself.
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username || url.password || url.search || url.hash) return undefined
  return baseOf(`${url.origin}${url.pathname}`)
}
