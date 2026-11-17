// The hashing the fingerprints share: the edge image's (fingerprint.ts) and the TMDB proxy's
// (tmdb-proxy/fingerprint.ts), which deploys without the app's dependencies, so this module imports
// only Node's.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** A file a fingerprint covers: its path where it ends up, and its bytes. */
export interface Part {
  path: string
  content: string | Uint8Array
}

/**
 * The hash of the parts, by path and content, whatever their order. A part's path and content are
 * hashed apart and then together, so no two different sets of parts can run into the same text.
 */
export function hashParts(parts: Part[]): string {
  const paths = parts.map((part) => part.path)
  const repeated = paths.find((path, index) => paths.indexOf(path) !== index)
  if (repeated !== undefined) throw new Error(`Two parts named ${repeated}`)
  const lines = parts
    .map((part) => `${sha256(part.path)} ${sha256(part.content)}`)
    .sort()
    .join('\n')
  return sha256(lines)
}

const sha256 = (content: string | Uint8Array): string => createHash('sha256').update(content).digest('hex')

/**
 * Every file under `dir`, with its path from `dir` (with `/`) under `prefix`. Throws on an entry
 * that is neither a file nor a folder (a symlink), which a build would still copy: what a
 * fingerprint can't read fails it rather than counting as nothing.
 */
export function filesUnder(dir: string, prefix: string): Part[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      const path = `${prefix}/${relative(dir, full).split(sep).join('/')}`
      if (!entry.isFile()) throw new Error(`${path} is neither a file nor a folder`)
      return { path, content: readFileSync(full) }
    })
}
