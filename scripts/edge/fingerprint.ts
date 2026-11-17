// The edge build's fingerprint: `node scripts/edge/fingerprint.ts <dist> <proxy>` prints a hash of
// what a Kinopeer Edge image runs, and edge.yml publishes a new image only when it differs from the
// one on the image the edge store points at (docs/DEVELOPMENT.md → Edge builds). So a change that
// reaches the image's sources but not what runs (a comment, a test helper, a script or a dev
// dependency in package.json, a tool's config) publishes no update. `<dist>` is the app built without
// KINOPEER_COMMIT, which every edge build bakes into it, and `<proxy>` the TMDB proxy address the
// image is built for.
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

/** A file the fingerprint covers: its path as the image has it, and its bytes. */
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
 * The Dockerfile's instructions without its comments and blank lines, which build the same image.
 * A Dockerfile's comment is a whole line starting with `#`; one inside a continued instruction is
 * dropped by Docker too. Parser directives (`# syntax=`) would count, but the Dockerfile has none.
 */
export function dockerfileInstructions(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
}

/**
 * What of package.json the image's server uses: `type`, which tells Node its `.ts` files are ES
 * modules, and `version`, which it reads for `/healthz`. The rest (scripts, dependencies) only builds.
 */
export function runtimePackage(text: string): string {
  const { type, version } = JSON.parse(text) as { type?: unknown; version?: unknown }
  return JSON.stringify({ type, version })
}

/**
 * Every file under `dir`, with its path from `dir` (with `/`) under `prefix`. Throws on an entry
 * that is neither a file nor a folder (a symlink), which the image would still copy: what the
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

/**
 * The server as it runs, minified: Vite bundles `entry` and what it imports into one file, without
 * comments, formatting or local names, so a change to those alone gives the same bundle. Only for the
 * hash: the image runs the sources as they are, which the tests run too.
 */
export async function serverBundle(root: string, entry: string): Promise<Part[]> {
  const outDir = mkdtempSync(join(tmpdir(), 'kinopeer-server-'))
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      root,
      build: { ssr: entry, minify: true, outDir, write: true },
    })
    return filesUnder(outDir, 'server')
  } finally {
    rmSync(outDir, { recursive: true })
  }
}

/** The fingerprint of the edge image built from `root`, with the app built into `dist`. */
export async function fingerprint({ root, dist, proxy }: { root: string; dist: string; proxy: string }): Promise<string> {
  return hashParts([
    ...filesUnder(dist, 'dist'),
    ...(await serverBundle(root, 'server/main.ts')),
    { path: 'Dockerfile', content: dockerfileInstructions(readFileSync(join(root, 'Dockerfile'), 'utf8')) },
    { path: 'package.json', content: runtimePackage(readFileSync(join(root, 'package.json'), 'utf8')) },
    { path: 'KINOPEER_TMDB_PROXY', content: proxy },
  ])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dist, proxy] = process.argv.slice(2)
  if (!dist || proxy === undefined) {
    console.error('Usage: node scripts/edge/fingerprint.ts <dist> <proxy>')
    process.exit(2)
  }
  console.log(await fingerprint({ root: process.cwd(), dist, proxy }))
}
