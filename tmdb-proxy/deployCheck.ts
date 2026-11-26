import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD_FILES } from './fingerprint.ts'

/**
 * Whether the TMDB proxy workflow (.github/workflows/tmdb-proxy.yml) deploys the checked-out commit
 * to an environment's worker: only when its proxy code is the newest for that worker, main's head for
 * `edge` and the highest version tag for `release`. A re-run of an older push or tag would otherwise
 * put older code back, and the worker could lack a path that newer builds call. It compares the
 * proxy's code, not commits, so a run isn't skipped because main moved on with a change Edge doesn't
 * build (docs, tests), which starts no run of its own.
 *
 *   node tmdb-proxy/deployCheck.ts edge <metafile>  →  deploy=true, and why on stderr
 *
 * The metafile is the build metadata of Wrangler's bundle (`wrangler deploy --dry-run --metafile`).
 */

/**
 * The proxy's code, as paths from the repository's root: every file Wrangler bundled into the
 * worker (the metafile's inputs, relative to tmdb-proxy/, where Wrangler runs), so a new import is
 * in it without anyone listing it, and the files that say how the worker is deployed, which its
 * fingerprint counts too (`BUILD_FILES`), the workflow among them. A package the worker imports is
 * an input under tmdb-proxy/node_modules, which git doesn't track: its version is in
 * package-lock.json, one of `BUILD_FILES`. A metafile that names no input, or one that isn't there,
 * fails the check rather than comparing less than the worker is built from.
 */
export function proxyCode(metafile: string, root = process.cwd()): string[] {
  let inputs: unknown
  try {
    inputs = (JSON.parse(readFileSync(metafile, 'utf8')) as { inputs?: unknown }).inputs
  } catch (error) {
    throw new Error(`Can't read Wrangler's build metadata at ${metafile}: ${(error as Error).message}`)
  }
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs) || Object.keys(inputs).length === 0) {
    throw new Error(`Wrangler's build metadata at ${metafile} names no input.`)
  }
  const proxy = join(root, 'tmdb-proxy')
  return [...Object.keys(inputs), ...BUILD_FILES].map((input) => {
    const path = resolve(proxy, input)
    const fromRoot = relative(root, path)
    if (fromRoot.startsWith('..') || !existsSync(path)) {
      throw new Error(`Wrangler's build metadata names ${input}, which isn't a file in the repository.`)
    }
    return fromRoot.split(sep).join('/')
  })
}

/** A version tag, v1.2.3 or v1.2.3-rc.1; other tags starting with v are left out. */
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

/** Orders version tags by number, a release above its prereleases (v0.7.0 > v0.7.0-rc.1). */
export function compareVersionTags(a: string, b: string): number {
  const [, majorA, minorA, patchA, preA] = VERSION_TAG.exec(a)!
  const [, majorB, minorB, patchB, preB] = VERSION_TAG.exec(b)!
  const difference =
    Number(majorA) - Number(majorB) || Number(minorA) - Number(minorB) || Number(patchA) - Number(patchB)
  if (difference || preA === preB) return difference
  if (preA === undefined) return 1
  if (preB === undefined) return -1
  return preA.localeCompare(preB, 'en', { numeric: true })
}

export function shouldDeploy(
  environment: string,
  code: string[],
  cwd = process.cwd(),
): { deploy: boolean; reason: string } {
  let newest: string
  if (environment === 'edge') {
    newest = 'origin/main'
  } else if (environment === 'release') {
    const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd, encoding: 'utf8' })
      .split('\n')
      .filter((tag) => VERSION_TAG.test(tag))
    const highest = tags.sort(compareVersionTags).at(-1)
    if (!highest) return { deploy: false, reason: 'There is no version tag.' }
    newest = highest
  } else {
    throw new Error(`Unknown environment ${environment}`)
  }
  // 0: the same, 1: different; anything else is git failing, which mustn't read as either.
  const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', newest, '--', ...code], { cwd, encoding: 'utf8' })
  if (diff.status === 0) return { deploy: true, reason: `The proxy's code is the same as at ${newest}.` }
  if (diff.status === 1) {
    return { deploy: false, reason: `${newest} has newer proxy code; the ${environment} worker stays as it is.` }
  }
  throw new Error(`git diff failed: ${diff.stderr}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [environment = '', metafile] = process.argv.slice(2)
  if (!metafile) throw new Error('Usage: node tmdb-proxy/deployCheck.ts <environment> <metafile>')
  const { deploy, reason } = shouldDeploy(environment, proxyCode(metafile))
  console.error(reason)
  console.log(`deploy=${deploy}`)
}
