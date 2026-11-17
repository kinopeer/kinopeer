// The edge build's fingerprint: `node scripts/edge/fingerprint.ts <dist> <proxy>` prints a hash of
// what a Kinopeer Edge image runs and of how it's built, and edge.yml publishes a new image only when
// it differs from the one on the image the edge store points at (docs/DEVELOPMENT.md → Edge builds).
// So a change that reaches the image's sources but not what runs (a comment, a test helper, a script
// or a dev dependency in package.json, a tool's config) publishes no update. `<dist>` is the app built without
// KINOPEER_COMMIT, which every edge build bakes into it, and `<proxy>` the TMDB proxy address the
// image is built for.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { filesUnder, hashParts, type Part } from './parts.ts'

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
 * The server as it runs, minified: Vite bundles `entry` and what it imports into one file, without
 * comments, formatting or local names, so a change to those alone gives the same bundle. Only for the
 * hash: the image runs the sources as they are, which the tests run too. It builds into a folder of
 * its own under `temp`, removed when it's done.
 */
export async function serverBundle(root: string, entry: string, temp = tmpdir()): Promise<Part[]> {
  const outDir = mkdtempSync(join(temp, 'kinopeer-server-'))
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      root,
      // The bundle alone: public/ goes into the image through dist/, which the fingerprint has.
      publicDir: false,
      build: { ssr: entry, minify: true, outDir, write: true },
    })
    return filesUnder(outDir, 'server')
  } finally {
    rmSync(outDir, { recursive: true })
  }
}

/**
 * How the image is built, whose files count whole: `.dockerignore`, which decides what the Docker
 * build reads, and the Edge workflow, which pins BuildKit, the platform and the actions that build and
 * push it, so a change to them, which the release checklist and TESTING have the next Edge run try
 * first, builds.
 */
export const BUILD_FILES = ['.dockerignore', '.github/workflows/edge.yml']

/** The fingerprint of the edge image built from `root`, with the app built into `dist`. */
export async function fingerprint({ root, dist, proxy }: { root: string; dist: string; proxy: string }): Promise<string> {
  return hashParts([
    ...filesUnder(dist, 'dist'),
    ...(await serverBundle(root, 'server/main.ts')),
    { path: 'Dockerfile', content: dockerfileInstructions(readFileSync(join(root, 'Dockerfile'), 'utf8')) },
    { path: 'package.json', content: runtimePackage(readFileSync(join(root, 'package.json'), 'utf8')) },
    { path: 'KINOPEER_TMDB_PROXY', content: proxy },
    ...BUILD_FILES.map((path) => ({ path, content: readFileSync(join(root, path)) })),
  ])
}

/**
 * The command's outcome for its arguments, run in `cwd`: the fingerprint, or how to run it when the
 * build folder or the proxy address is missing (an empty address counts, as the Dockerfile's default).
 */
export async function main(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const [dist, proxy] = args
  if (!dist || proxy === undefined) return { code: 2, out: 'Usage: node scripts/edge/fingerprint.ts <dist> <proxy>' }
  return { code: 0, out: await fingerprint({ root: cwd, dist: resolve(cwd, dist), proxy }) }
}

// Run as a script rather than imported: the fingerprint on stdout, the usage on stderr.
if (import.meta.main) {
  const { code, out } = await main(process.argv.slice(2), process.cwd())
  if (code === 0) console.log(out)
  else console.error(out)
  process.exitCode = code
}
