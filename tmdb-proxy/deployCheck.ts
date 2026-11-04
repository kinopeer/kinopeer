import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Whether the TMDB proxy workflow (.github/workflows/tmdb-proxy.yml) deploys the checked-out commit
 * to an environment's worker: only when its proxy code is the newest for that worker, main's head for
 * `edge` and the highest version tag for `release`. A re-run of an older push or tag would otherwise
 * put older code back, and the worker could lack a path that newer builds call. It compares the
 * proxy's code, not commits, so a run isn't skipped because main moved on with a change Edge doesn't
 * build (docs, tests), which starts no run of its own.
 *
 *   node tmdb-proxy/deployCheck.ts edge  →  deploy=true, and why on stderr
 */

/** What goes into the worker: `tmdb-proxy/` without its tests. */
const PROXY_CODE = ['tmdb-proxy', ':(exclude)tmdb-proxy/*.test.ts']

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

export function shouldDeploy(environment: string, cwd = process.cwd()): { deploy: boolean; reason: string } {
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
  const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', newest, '--', ...PROXY_CODE], { cwd, encoding: 'utf8' })
  if (diff.status === 0) return { deploy: true, reason: `The proxy's code is the same as at ${newest}.` }
  if (diff.status === 1) {
    return { deploy: false, reason: `${newest} has newer proxy code; the ${environment} worker stays as it is.` }
  }
  throw new Error(`git diff failed: ${diff.stderr}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { deploy, reason } = shouldDeploy(process.argv[2] ?? '')
  console.error(reason)
  console.log(`deploy=${deploy}`)
}
