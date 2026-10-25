import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidTorrentError, readTorrentFile } from './torrentFile'

type Value = number | string | Uint8Array | Value[] | { [key: string]: Value }

/** Minimal bencode encoder for building test torrents. Keys are sorted, as the spec requires. */
function encode(value: Value): Uint8Array {
  const parts: Uint8Array[] = []
  const utf8 = (text: string) => new TextEncoder().encode(text)
  const walk = (item: Value) => {
    if (typeof item === 'number') parts.push(utf8(`i${item}e`))
    else if (typeof item === 'string') walk(utf8(item))
    else if (ArrayBuffer.isView(item)) parts.push(utf8(`${item.length}:`), item)
    else if (Array.isArray(item)) {
      parts.push(utf8('l'))
      item.forEach(walk)
      parts.push(utf8('e'))
    } else {
      parts.push(utf8('d'))
      for (const key of Object.keys(item).sort()) {
        walk(key)
        walk((item as Record<string, Value>)[key])
      }
      parts.push(utf8('e'))
    }
  }
  walk(value)
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const pieces = new Uint8Array(20).fill(7)

async function digest(algorithm: 'SHA-1' | 'SHA-256', value: Value): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest(algorithm, encode(value) as Uint8Array<ArrayBuffer>))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('readTorrentFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a multi-file torrent and hashes its info dictionary', async () => {
    const info: Value = {
      name: 'Дюна (2021) BDRip',
      'piece length': 262144,
      pieces,
      files: [
        { length: 2_000_000_000, path: ['Dune.2021.mkv'] },
        { length: 1024, path: ['Subs', 'rus.srt'] },
        { length: 10, path: ['.pad', '10'], attr: 'p' },
      ],
    }
    const meta = await readTorrentFile(encode({ announce: 'http://tracker.example/announce', info }))
    expect(meta).toEqual({
      infoHash: await digest('SHA-1', info),
      name: 'Дюна (2021) BDRip',
      files: [
        { path: 'Dune.2021.mkv', size: 2_000_000_000 },
        { path: 'Subs/rus.srt', size: 1024 },
      ],
      totalSize: 2_000_001_024,
    })
  })

  it('reads a single-file torrent', async () => {
    const info: Value = { length: 5000, name: 'Arrival.2016.mkv', 'piece length': 16384, pieces }
    const meta = await readTorrentFile(encode({ info }).buffer as ArrayBuffer)
    expect(meta.files).toEqual([{ path: 'Arrival.2016.mkv', size: 5000 }])
    expect(meta.infoHash).toBe(await digest('SHA-1', info))
  })

  it('reads a v2-only torrent and truncates its SHA-256 hash', async () => {
    const info: Value = {
      name: 'Show',
      'meta version': 2,
      'piece length': 16384,
      'file tree': { 'S01E01.mkv': { '': { length: 300 } }, Extras: { 'a.txt': { '': { length: 2 } } } },
    }
    const meta = await readTorrentFile(encode({ info }))
    // Bencoded dictionaries are sorted by key, and that is the file order.
    expect(meta.files).toEqual([
      { path: 'Extras/a.txt', size: 2 },
      { path: 'S01E01.mkv', size: 300 },
    ])
    expect(meta.infoHash).toBe((await digest('SHA-256', info)).slice(0, 40))
  })

  it('rejects files that are not torrents', async () => {
    await expect(readTorrentFile(new TextEncoder().encode('<html>Cloudflare</html>'))).rejects.toBeInstanceOf(InvalidTorrentError)
    await expect(readTorrentFile(encode({ announce: 'x' }))).rejects.toBeInstanceOf(InvalidTorrentError)
    await expect(readTorrentFile(new Uint8Array())).rejects.toBeInstanceOf(InvalidTorrentError)
  })

  it('hashes without Web Crypto, as over plain HTTP', async () => {
    const torrent = { announce: 'http://t', info: { name: 'Movie', length: 10, 'piece length': 16384, pieces } }
    const expected = await digest('SHA-1', torrent.info)
    vi.stubGlobal('crypto', {})
    const meta = await readTorrentFile(encode(torrent))
    expect(meta.infoHash).toBe(expected)
  })
})
