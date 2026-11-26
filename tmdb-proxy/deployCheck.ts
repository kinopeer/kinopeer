import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
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
 * What a change to counts as newer proxy code, as git pathspecs from the repository's root:
 *
 * - every file Wrangler bundled into the worker (the metafile's inputs, relative to tmdb-proxy/,
 *   where Wrangler runs), so an import from `src/` counts without anyone listing it, each taken by
 *   its name alone (`:(literal)`), since a name can hold a pattern's characters;
 * - `tmdb-proxy/` without its tests, for what the bundler reads there without listing it as an
 *   input: the folder's package.json, a tsconfig.json of its own;
 * - the root tsconfig.json and package.json, which esbuild reads for every file without one nearer
 *   (a package.json's `sideEffects` and `imports`);
 * - the files that say how the worker is deployed, which its fingerprint counts too (`BUILD_FILES`),
 *   the workflow among them.
 *
 * Each of these starts an Edge run when it changes (edge.yml's `paths`), so counting more than the
 * worker needs only skips a run that a newer one replaces. A package the worker imports is an input
 * under tmdb-proxy/node_modules, which git doesn't track: its version is in package-lock.json, one
 * of `BUILD_FILES`. A metafile that names no input, or an input that isn't a file in the
 * repository, fails the check rather than comparing less than the worker is built from. So does a
 * module a bundled file imports that Wrangler uploads beside the bundle (by its module rules, such as
 * an .html, .txt, .sql, .bin or .wasm import, wherever it sits), since the metafile names it only by
 * a hash and the check can't tell which file it is: a worker that needs one changes this check
 * first, to name the file. Nor does the metafile name the modules `find_additional_modules` would
 * upload without an import, which wrangler.jsonc doesn't set.
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
  const fromRoot = (path: string) => relative(root, resolve(proxy, path)).split(sep).join('/')
  const bundled = Object.entries(inputs as Record<string, { imports?: { path: string; external?: boolean }[] }>).map(
    ([input, { imports = [] }]) => {
      const path = resolve(proxy, input)
      const outside = relative(root, path)
      if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside) || !existsSync(path)) {
        throw new Error(`Wrangler's build metadata names ${input}, which isn't a file in the repository.`)
      }
      const untraced = imports.find(({ path, external }) => external && !RUNTIME_MODULE.test(path))
      if (untraced) {
        throw new Error(
          `${input} imports ${untraced.path}, which Wrangler uploads beside the bundle without naming its file; ` +
            'the deploy check can\'t compare it (tmdb-proxy/deployCheck.ts).',
        )
      }
      return `:(literal)${fromRoot(input)}`
    },
  )
  return [
    'tmdb-proxy',
    ':(exclude)tmdb-proxy/*.test.ts',
    ':(literal)tsconfig.json',
    ':(literal)package.json',
    ...bundled,
    ...BUILD_FILES.map((file) => `:(literal)${fromRoot(file)}`),
  ]
}

/** What a bundle imports from the runtime rather than from a file: esbuild's helpers, Node's and Workers' modules. */
const RUNTIME_MODULE = /^(<runtime>$|node:|cloudflare:)/

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
