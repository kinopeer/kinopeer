export interface MagnetLink {
  /** Lowercase hex, as qBittorrent shows it (a v2 hash truncated to 40 digits). */
  infoHash: string
  /** The "dn" display name, if any. */
  name?: string
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32ToHex(value: string): string | undefined {
  let bits = ''
  for (const char of value.toUpperCase()) {
    const index = BASE32.indexOf(char)
    if (index < 0) return undefined
    bits += index.toString(2).padStart(5, '0')
  }
  return bits.match(/.{4}/g)?.map((nibble) => parseInt(nibble, 2).toString(16)).join('')
}

/** Parses a magnet link with a BitTorrent v1 (btih) or v2 (btmh) hash; undefined for anything else. */
export function parseMagnet(uri: string): MagnetLink | undefined {
  const trimmed = uri.trim()
  if (!/^magnet:\?/i.test(trimmed)) return undefined
  const params = new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1))
  const name = params.get('dn')?.trim() || undefined

  let infoHash: string | undefined
  for (const xt of params.getAll('xt')) {
    const v1 = /^urn:btih:([0-9a-f]{40}|[a-z2-7]{32})$/i.exec(xt)
    if (v1) {
      infoHash = v1[1].length === 40 ? v1[1].toLowerCase() : base32ToHex(v1[1])
      break
    }
    // A sha2-256 multihash: 0x12, length 0x20, then the digest.
    const v2 = /^urn:btmh:1220([0-9a-f]{64})$/i.exec(xt)
    if (v2) infoHash ??= v2[1].slice(0, 40).toLowerCase()
  }
  return infoHash ? { infoHash, name } : undefined
}
