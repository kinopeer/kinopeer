import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareVersionTags, proxyCode, shouldDeploy } from './deployCheck.ts'

const repos: string[] = []

/** Git without the developer's own config, whose hooks or templates would run in the test's commits. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

/** A git repository with one commit of the proxy, as the workflow's checkout has it. */
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'kinopeer-proxy-'))
  repos.push(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  const commit = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true })
      writeFileSync(join(cwd, path), content)
    }
    git('add', '-A')
    git('commit', '-q', '-m', Object.keys(files).join(' '))
    return git('rev-parse', 'HEAD')
  }
  /** Where the workflow's checkout stands, and what it fetched of main. */
  const at = (sha: string, main = sha) => {
    git('checkout', '-q', '--detach', sha)
    git('update-ref', 'refs/remotes/origin/main', main)
  }
  const tag = (name: string, sha: string) => git('tag', name, sha)
  /** Wrangler's build metadata naming these inputs, beside the checkout, as the workflow keeps it in its temp folder. */
  const metafile = (...inputs: string[]) => {
    const path = `${cwd}-meta.json`
    repos.push(path)
    writeFileSync(path, JSON.stringify({ inputs: Object.fromEntries(inputs.map((input) => [input, {}])), outputs: {} }))
    return path
  }
  const first = commit({ 'tmdb-proxy/worker.ts': 'v1', 'README.md': 'readme' })
  return { cwd, commit, at, tag, metafile, first }
}

/** What a run passes as the proxy's code (proxyCode, below, derives it from the bundle). */
const CODE = [
  'tmdb-proxy',
  ':(exclude)tmdb-proxy/*.test.ts',
  ':(literal)src/logic/privateOrigin.ts',
  ':(literal).github/workflows/tmdb-proxy.yml',
]

afterEach(() => {
  for (const cwd of repos.splice(0)) rmSync(cwd, { recursive: true, force: true })
})

describe('shouldDeploy', () => {
  describe('edge', () => {
    it('deploys main’s head', () => {
      const { cwd, at, first } = repo()
      at(first)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('deploys an older commit when main moved on without touching the proxy', () => {
      const { cwd, commit, at, first } = repo()
      const docs = commit({ 'README.md': 'more' })
      at(first, docs)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('deploys an older commit when main changed only the proxy’s tests', () => {
      const { cwd, commit, at, first } = repo()
      const tests = commit({ 'tmdb-proxy/worker.test.ts': 'test' })
      at(first, tests)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('leaves the worker when main has newer proxy code', () => {
      const { cwd, commit, at, first } = repo()
      const newer = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      at(first, newer)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: false })
    })

    it('leaves the worker when main changed only a file the worker imports from outside tmdb-proxy/', () => {
      const { cwd, commit, at, first } = repo()
      const newer = commit({ 'src/logic/privateOrigin.ts': 'v2' })
      at(first, newer)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: false })
    })

    it('leaves the worker when main has a newer Wrangler config', () => {
      const { cwd, commit, at, first } = repo()
      const newer = commit({ 'tmdb-proxy/wrangler.jsonc': '{ "limit": 50 }' })
      at(first, newer)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: false })
    })

    it('deploys an older commit when main changed only files outside the proxy’s code', () => {
      const { cwd, commit, at, first } = repo()
      const other = commit({ 'src/logic/other.ts': 'v2', '.github/workflows/ci.yml': 'v2' })
      at(first, other)

      expect(shouldDeploy('edge', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('compares a bundled file whose name reads as a pattern by that name alone', () => {
      const { cwd, commit, at, metafile } = repo()
      const deployed = commit({
        'src/logic/[id].ts': 'v1',
        'tmdb-proxy/wrangler.jsonc': '{}',
        'tmdb-proxy/package-lock.json': '{}',
        '.github/workflows/tmdb-proxy.yml': 'steps: []',
      })
      // As a pattern, src/logic/[id].ts would match this file.
      const other = commit({ 'src/logic/i.ts': 'v2' })
      at(deployed, other)
      expect(shouldDeploy('edge', proxyCode(metafile('worker.ts', '../src/logic/[id].ts'), cwd), cwd)).toMatchObject({ deploy: true })
    })
  })

  describe('release', () => {
    it('deploys the highest tag', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      const next = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.7.0', next)
      at(next)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('leaves the worker for an older tag when the proxy changed since', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      tag('v0.7.0', commit({ 'tmdb-proxy/worker.ts': 'v2' }))
      at(first)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: false })
    })

    it('deploys an older tag when the proxy is the same as the highest one’s', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      tag('v0.6.2', commit({ 'README.md': 'more' }))
      at(first)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('ranks a release above its prerelease', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.7.0-rc.1', first)
      const release = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.7.0', release)
      at(release)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: true })
      at(first)
      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: false })
    })

    it('compares versions by number, not as text', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.9.0', first)
      const tenth = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.10.0', tenth)
      at(tenth)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: true })
    })

    it('ignores tags that aren’t versions', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      const other = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      for (const name of ['vacation', 'vendor-v9.0.0', 'v9.0.0.1', 'v9.0', 'v9.0.0-']) tag(name, other)
      at(first)

      expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: true })
    })
  })

  it('deploys nothing to the release worker before the first version tag', () => {
    const { cwd, at, first } = repo()
    at(first)

    expect(shouldDeploy('release', CODE, cwd)).toMatchObject({ deploy: false })
  })

  it('fails rather than skipping when git can’t compare', () => {
    const { cwd, first } = repo()
    execFileSync('git', ['checkout', '-q', '--detach', first], { cwd, env: GIT_ENV })

    expect(() => shouldDeploy('edge', CODE, cwd)).toThrow('git diff failed')
  })

  it('refuses an environment it doesn’t know', () => {
    const { cwd, at, first } = repo()
    at(first)

    expect(() => shouldDeploy('staging', CODE, cwd)).toThrow('Unknown environment staging')
  })

  it('prints its answer for the workflow’s output, and why on stderr', () => {
    const { cwd, commit, at, metafile } = repo()
    const deployed = commit({
      'tmdb-proxy/wrangler.jsonc': '{}',
      'tmdb-proxy/package-lock.json': '{}',
      '.github/workflows/tmdb-proxy.yml': 'steps: []',
    })
    const newer = commit({ 'tmdb-proxy/worker.ts': 'v2' })
    const meta = metafile('worker.ts')
    const script = join(import.meta.dirname, 'deployCheck.ts')
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: GIT_ENV })

    at(newer)
    expect(run('edge', meta).stdout).toBe('deploy=true\n')
    expect(run('edge', meta).stderr).toContain('the same as at origin/main')
    at(deployed, newer)
    expect(run('edge', meta).stdout).toBe('deploy=false\n')
    expect(run('edge').stderr).toContain('Usage: node tmdb-proxy/deployCheck.ts <environment> <metafile>')
    expect(run('staging', meta).stderr).toContain('Unknown environment')
  })
})

describe('proxyCode', () => {
  /** A checkout with the worker, a rule it imports from src/ and the files that say how it's deployed. */
  function checkout(meta: unknown) {
    // The checkout in a folder of its own, beside a file outside it that a metafile could name.
    const folder = mkdtempSync(join(tmpdir(), 'kinopeer-proxy-'))
    repos.push(folder)
    writeFileSync(join(folder, 'outside.ts'), 'outside')
    const root = join(folder, 'checkout')
    const files = [
      'tmdb-proxy/worker.ts',
      'tmdb-proxy/wrangler.jsonc',
      'tmdb-proxy/package-lock.json',
      'tmdb-proxy/node_modules/some-package/index.js',
      '.github/workflows/tmdb-proxy.yml',
      'src/logic/privateOrigin.ts',
    ]
    for (const path of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), path)
    }
    const metafile = join(root, 'meta.json')
    writeFileSync(metafile, typeof meta === 'string' ? meta : JSON.stringify(meta))
    return { root, metafile }
  }
  const inputs = (...paths: string[]) => ({ inputs: Object.fromEntries(paths.map((path) => [path, {}])), outputs: {} })

  it('names what the worker is bundled from, from the root, and the files that say how it’s deployed', () => {
    const { root, metafile } = checkout(inputs('../src/logic/privateOrigin.ts', 'worker.ts', 'node_modules/some-package/index.js'))

    expect(proxyCode(metafile, root)).toEqual([
      'tmdb-proxy',
      ':(exclude)tmdb-proxy/*.test.ts',
      ':(literal)tsconfig.json',
      ':(literal)package.json',
      ':(literal)src/logic/privateOrigin.ts',
      ':(literal)tmdb-proxy/worker.ts',
      ':(literal)tmdb-proxy/node_modules/some-package/index.js',
      ':(literal)tmdb-proxy/wrangler.jsonc',
      ':(literal)tmdb-proxy/package-lock.json',
      ':(literal).github/workflows/tmdb-proxy.yml',
    ])
  })

  it('takes the modules the runtime gives: esbuild’s helpers, Node’s and Workers’', () => {
    const imports = ['<runtime>', 'node:buffer', 'cloudflare:workers'].map((path) => ({ path, kind: 'import-statement', external: true }))
    const { root, metafile } = checkout({ inputs: { 'worker.ts': { imports } } })

    expect(proxyCode(metafile, root)).toContain(':(literal)tmdb-proxy/worker.ts')
  })

  it.each([
    ['isn’t JSON', 'not json', "Can't read"],
    ['has no inputs', { outputs: {} }, 'names no input'],
    ['has null for its inputs', { inputs: null }, 'names no input'],
    ['has inputs that aren’t an object', { inputs: ['worker.ts'] }, 'names no input'],
    ['has none in its inputs', inputs(), 'names no input'],
    ['names an input that isn’t there', inputs('worker.ts', 'gone.ts'), "names gone.ts, which isn't a file"],
    ['names an input outside the repository', inputs('worker.ts', '../../outside.ts'), "names ../../outside.ts, which isn't a file"],
    [
      'has a module Wrangler uploads beside the bundle, named only by a hash',
      { inputs: { 'worker.ts': { imports: [{ path: './55ca6286-page.html', kind: 'import-statement', external: true }] } } },
      "worker.ts imports ./55ca6286-page.html, which Wrangler uploads beside the bundle without naming its file",
    ],
    ['names the folder above the repository', inputs('worker.ts', '../..'), "names ../.., which isn't a file"],
    [
      'has a module that only starts like the runtime’s',
      { inputs: { 'worker.ts': { imports: [{ path: '<runtime>-page.html', kind: 'import-statement', external: true }] } } },
      'worker.ts imports <runtime>-page.html',
    ],
    [
      'has a module that only reads like the runtime’s',
      { inputs: { 'worker.ts': { imports: [{ path: './<runtime>', kind: 'import-statement', external: true }] } } },
      'worker.ts imports ./<runtime>',
    ],
  ])('fails rather than comparing less when the metadata %s', (_case, meta, message) => {
    const { root, metafile } = checkout(meta)

    expect(() => proxyCode(metafile, root)).toThrow(message)
  })

  it('fails when the metadata isn’t there', () => {
    const { root } = checkout(inputs('worker.ts'))

    expect(() => proxyCode(join(root, 'none.json'), root)).toThrow("Can't read Wrangler's build metadata")
  })
})

describe('compareVersionTags', () => {
  it('orders versions by number, a release above its prereleases', () => {
    const tags = ['v1.0.0', 'v0.10.0', 'v0.7.0', 'v0.7.0-rc.10', 'v0.6.12', 'v0.7.0-rc.2', 'v10.0.0', 'v0.6.2']

    expect(tags.sort(compareVersionTags)).toEqual([
      'v0.6.2',
      'v0.6.12',
      'v0.7.0-rc.2',
      'v0.7.0-rc.10',
      'v0.7.0',
      'v0.10.0',
      'v1.0.0',
      'v10.0.0',
    ])
  })

  it('compares a release with its prereleases, prereleases by name, and a tag with itself', () => {
    expect(compareVersionTags('v0.7.0', 'v0.7.0')).toBe(0)
    expect(compareVersionTags('v0.7.0-rc.1', 'v0.7.0-rc.1')).toBe(0)
    expect(compareVersionTags('v0.7.0', 'v0.7.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersionTags('v0.7.0-rc.1', 'v0.7.0')).toBeLessThan(0)
    // A prerelease name that sorts after "undefined" as text, so a missing check can't pass by luck.
    expect(compareVersionTags('v0.7.0-zeta', 'v0.7.0')).toBeLessThan(0)
    expect(compareVersionTags('v0.7.0-rc.10', 'v0.7.0-rc.2')).toBeGreaterThan(0)
    expect(compareVersionTags('v0.7.0-rc.2', 'v0.7.0-rc.10')).toBeLessThan(0)
  })
})
