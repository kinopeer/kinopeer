// The TMDB proxy's fingerprint: `node fingerprint.ts <bundle>`, run in tmdb-proxy/, prints a hash
// of what a deploy puts on a worker and how: what Wrangler bundles
// (`wrangler deploy --dry-run --outdir <bundle>`) and the files in BUILD_FILES. tmdb-proxy.yml tags
// each version it deploys with it, and leaves a worker whose version has the same tag as it is
// (docs/DEVELOPMENT.md → The TMDB proxy). The key doesn't count: nothing derived from it goes into
// a tag, and a changed key reaches the workers through tmdb-proxy-key.yml.
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
 * The bundle and BUILD_FILES under `root`. The bundle's README (with the time it was built) and
 * source maps (with the folder it was built in) differ on every build and aren't the worker; every
 * other file in it is, whatever its kind (a .wasm or text module included), so none is left out.
 */
export function workerFingerprint({ bundle, root }: { bundle: string; root: string }): string {
  return hashParts([
    ...filesUnder(bundle, 'bundle').filter((part) => part.path !== 'bundle/README.md' && !part.path.endsWith('.map')),
    ...BUILD_FILES.map((path) => ({ path, content: readFileSync(join(root, path)) })),
  ])
}

/** The command's outcome for its arguments, run in `cwd`. */
export function main(args: string[], cwd: string): { code: number; out: string } {
  const [bundle] = args
  if (!bundle) return { code: 2, out: 'Usage: node fingerprint.ts <bundle>, in tmdb-proxy/' }
  return { code: 0, out: workerFingerprint({ bundle: resolve(cwd, bundle), root: cwd }) }
}

// Run as a script rather than imported: the fingerprint on stdout, what's wrong on stderr.
if (import.meta.main) {
  const { code, out } = main(process.argv.slice(2), process.cwd())
  if (code === 0) console.log(out)
  else console.error(out)
  process.exitCode = code
}
