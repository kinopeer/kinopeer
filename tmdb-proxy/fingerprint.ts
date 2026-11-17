// The TMDB proxy's fingerprint: `node fingerprint.ts <bundle>`, run in tmdb-proxy/ with TMDB_API_KEY
// set, prints a hash of what a deploy puts on a worker and how: the JavaScript Wrangler bundles
// (`wrangler deploy --dry-run --outdir <bundle>`), the files in BUILD_FILES and the key.
// tmdb-proxy.yml tags each version it deploys with it, and leaves a worker whose version has the
// same tag as it is (docs/DEVELOPMENT.md → The TMDB proxy). The key counts, so a key changed in the
// deploy environment still reaches the workers; the tag is a hash, from which the key can't be read.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { filesUnder, hashParts } from '../scripts/edge/parts.ts'

/**
 * What says how a worker is deployed, relative to tmdb-proxy/: its config, Wrangler's version
 * and the deploy itself, so a Wrangler update (TESTING.md counts on its first run being the next
 * Edge run) or a change to the deploy deploys rather than only being tried in the dry run.
 */
export const BUILD_FILES = ['wrangler.jsonc', 'package-lock.json', '../.github/workflows/tmdb-proxy.yml']

/**
 * The bundle's JavaScript, BUILD_FILES under `root` and the key. The bundle's README (with the time
 * it was built) and source map (with the folder it was built in) differ on every build and aren't
 * the worker.
 */
export function workerFingerprint({ bundle, root, key }: { bundle: string; root: string; key: string }): string {
  return hashParts([
    ...filesUnder(bundle, 'bundle').filter((part) => /\.m?js$/.test(part.path)),
    ...BUILD_FILES.map((path) => ({ path, content: readFileSync(join(root, path)) })),
    { path: 'TMDB_API_KEY', content: key },
  ])
}

/** The command's outcome for its arguments and environment, run in `cwd`. */
export function main(args: string[], env: { TMDB_API_KEY?: string }, cwd: string): { code: number; out: string } {
  const [bundle] = args
  if (!bundle) return { code: 2, out: 'Usage: node fingerprint.ts <bundle>, in tmdb-proxy/ with TMDB_API_KEY set' }
  if (!env.TMDB_API_KEY) return { code: 1, out: 'TMDB_API_KEY is not set' }
  return { code: 0, out: workerFingerprint({ bundle: resolve(cwd, bundle), root: cwd, key: env.TMDB_API_KEY }) }
}

// Run as a script rather than imported: the fingerprint on stdout, what's wrong on stderr.
if (import.meta.main) {
  const { code, out } = main(process.argv.slice(2), process.env, process.cwd())
  if (code === 0) console.log(out)
  else console.error(out)
  process.exitCode = code
}
