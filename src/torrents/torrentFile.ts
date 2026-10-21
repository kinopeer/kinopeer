/** What a .torrent file holds that matters before adding it: its hash, name and files. */
export interface TorrentMeta {
  /**
   * The hash qBittorrent identifies the torrent by: the v1 info hash (SHA-1), or for a v2-only
   * torrent the SHA-256 one truncated to 40 hex digits. Lowercase.
   */
  infoHash: string
  name: string
  /** In the order qBittorrent indexes them. Paths use "/" and start below the torrent's folder. */
  files: { path: string; size: number }[]
  totalSize: number
}

export class InvalidTorrentError extends Error {
  constructor(message = 'Not a valid .torrent file') {
    super(message)
    this.name = 'InvalidTorrentError'
  }
}

type BValue = number | Uint8Array | BValue[] | BDict
interface BDict {
  [key: string]: BValue
}

/** Decodes bencode, also returning where the top-level "info" dictionary starts and ends. */
function decode(bytes: Uint8Array): { value: BValue; info?: [number, number] } {
  let pos = 0
  let info: [number, number] | undefined

  const fail = (): never => {
    throw new InvalidTorrentError()
  }
  const digitsUntil = (end: number): number => {
    const stop = bytes.indexOf(end, pos)
    if (stop < 0) fail()
    const text = new TextDecoder().decode(bytes.subarray(pos, stop))
    if (!/^-?\d+$/.test(text)) fail()
    pos = stop + 1
    return Number(text)
  }
  const next = (depth: number): BValue => {
    if (depth > 64 || pos >= bytes.length) fail()
    const byte = bytes[pos]
    if (byte === 0x69 /* i */) {
      pos++
      return digitsUntil(0x65 /* e */)
    }
    if (byte === 0x6c /* l */) {
      pos++
      const list: BValue[] = []
      while (bytes[pos] !== 0x65) list.push(next(depth + 1))
      pos++
      return list
    }
    if (byte === 0x64 /* d */) {
      pos++
      const dict: BDict = {}
      while (bytes[pos] !== 0x65) {
        const key = next(depth + 1)
        if (!isBytes(key)) fail()
        const name = new TextDecoder().decode(key as Uint8Array)
        const start = pos
        dict[name] = next(depth + 1)
        if (depth === 0 && name === 'info') info = [start, pos]
      }
      pos++
      return dict
    }
    const length = digitsUntil(0x3a /* : */)
    if (length < 0 || pos + length > bytes.length) fail()
    pos += length
    return bytes.subarray(pos - length, pos)
  }

  const value = next(0)
  return { value, info }
}

// ArrayBuffer.isView rather than instanceof: the bytes may come from another realm (a worker, tests).
const isBytes = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value)

const isDict = (value: BValue | undefined): value is BDict =>
  typeof value === 'object' && !isBytes(value) && !Array.isArray(value)

function text(value: BValue | undefined): string | undefined {
  return isBytes(value) ? new TextDecoder().decode(value) : undefined
}

async function hex(algorithm: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** v2 "file tree": nested dictionaries ending in { "": { length } }. */
function walkFileTree(tree: BDict, prefix: string[], out: TorrentMeta['files']): void {
  for (const [name, node] of Object.entries(tree)) {
    if (!isDict(node)) continue
    const leaf = node['']
    if (isDict(leaf) && typeof leaf.length === 'number') out.push({ path: [...prefix, name].join('/'), size: leaf.length })
    else walkFileTree(node, [...prefix, name], out)
  }
}

export async function readTorrentFile(data: ArrayBuffer | Uint8Array): Promise<TorrentMeta> {
  const bytes = isBytes(data) ? data : new Uint8Array(data)
  const { value, info: range } = decode(bytes)
  const info = isDict(value) ? value.info : undefined
  if (!isDict(info) || !range) throw new InvalidTorrentError()

  const name = text(info['name.utf-8']) ?? text(info.name) ?? ''
  const files: TorrentMeta['files'] = []
  if (Array.isArray(info.files)) {
    for (const file of info.files) {
      if (!isDict(file) || typeof file.length !== 'number') continue
      const parts = file['path.utf-8'] ?? file.path
      if (!Array.isArray(parts)) continue
      // BEP 47 padding files aren't real files; qBittorrent hides them too.
      const attr = text(file.attr) ?? ''
      if (attr.includes('p')) continue
      files.push({ path: parts.map((part) => text(part) ?? '').join('/'), size: file.length })
    }
  } else if (typeof info.length === 'number') {
    files.push({ path: name, size: info.length })
  } else if (isDict(info['file tree'])) {
    walkFileTree(info['file tree'], [], files)
  }
  if (!files.length) throw new InvalidTorrentError()

  const infoBytes = bytes.subarray(range[0], range[1])
  const v1 = isBytes(info.pieces)
  const infoHash = v1 ? await hex('SHA-1', infoBytes) : (await hex('SHA-256', infoBytes)).slice(0, 40)

  return { infoHash, name, files, totalSize: files.reduce((sum, file) => sum + file.size, 0) }
}
