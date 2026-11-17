import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILD_FILES, main, workerFingerprint } from './fingerprint.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A folder with these files in it, removed after the test. */
function folderWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kinopeer-proxy-fingerprint-test-'))
  folders.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

// A repository whose tmdb-proxy/ ran `wrangler deploy --dry-run --outdir bundle`: what Wrangler
// writes there, beside the files that say how the worker is deployed.
const proxy = {
  'tmdb-proxy/wrangler.jsonc': '{ "name": "kinopeer-tmdb", "main": "worker.ts" }\n',
  'tmdb-proxy/package-lock.json': '{ "packages": { "node_modules/wrangler": { "version": "4.0.0" } } }\n',
  '.github/workflows/tmdb-proxy.yml': 'name: TMDB proxy\n',
  'tmdb-proxy/bundle/worker.js': 'export default { fetch() {} }\n',
  'tmdb-proxy/bundle/worker.js.map': '{"sourceRoot":"/tmp/a"}',
  'tmdb-proxy/bundle/README.md': 'Generated at 2026-11-17T12:55:46.025Z.',
}

describe('workerFingerprint', () => {
  const of = (files: Record<string, string>) => {
    const root = join(folderWith(files), 'tmdb-proxy')
    return workerFingerprint({ bundle: join(root, 'bundle'), root })
  }

  it("stays when only the bundle's README or source map changes, which every build does", () => {
    expect(
      of({ ...proxy, 'tmdb-proxy/bundle/worker.js.map': '{"sourceRoot":"/tmp/b"}', 'tmdb-proxy/bundle/README.md': 'Generated at 2026-11-17T12:55:47.000Z.' }),
    ).toBe(of(proxy))
  })

  it('changes with the bundle, an ES module in it, the config, Wrangler or the deploy', () => {
    const hash = of(proxy)
    const changed = [
      of({ ...proxy, 'tmdb-proxy/bundle/worker.js': 'export default { fetch() { return 1 } }\n' }),
      of({ ...proxy, 'tmdb-proxy/bundle/chunk.mjs': 'export const a = 1\n' }),
      of({ ...proxy, 'tmdb-proxy/wrangler.jsonc': '{ "name": "kinopeer-tmdb", "main": "worker.ts", "routes": [] }\n' }),
      of({ ...proxy, 'tmdb-proxy/package-lock.json': '{ "packages": { "node_modules/wrangler": { "version": "4.0.1" } } }\n' }),
      of({ ...proxy, '.github/workflows/tmdb-proxy.yml': 'name: TMDB proxy\n# a comment\n' }),
    ]
    for (const other of changed) expect(other).not.toBe(hash)
  })

  it('fails without a file that says how the worker is deployed', () => {
    for (const path of BUILD_FILES) {
      const files: Record<string, string> = { ...proxy }
      const file = join('tmdb-proxy', path)
      expect(Object.keys(files)).toContain(file)
      delete files[file]
      expect(() => of(files), path).toThrow('ENOENT')
    }
  })

})

describe('main', () => {
  it('gives the fingerprint of the bundle, relative to the folder it runs in, with its build files', () => {
    const root = join(folderWith(proxy), 'tmdb-proxy')
    expect(main(['bundle'], root)).toEqual({ code: 0, out: workerFingerprint({ bundle: join(root, 'bundle'), root }) })
  })

  it('says how to run it without the bundle', () => {
    expect(main([], tmpdir())).toEqual({ code: 2, out: 'Usage: node fingerprint.ts <bundle>, in tmdb-proxy/' })
  })
})

// What tmdb-proxy.yml runs: the script itself, in a child process, where Stryker's mutants don't reach.
describe('the script', () => {
  const script = fileURLToPath(new URL('./fingerprint.ts', import.meta.url))
  const run = (cwd: string, args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })

  it('prints the fingerprint alone on stdout', () => {
    const root = join(folderWith(proxy), 'tmdb-proxy')
    const result = run(root, ['bundle'])
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toBe(`${main(['bundle'], root).out}\n`)
  })

  it('does nothing when imported', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)})`], {
      cwd: tmpdir(),
      encoding: 'utf8',
    })
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '' })
  })

  it('prints how to run it on stderr and fails without the bundle', () => {
    expect(run(tmpdir(), [])).toMatchObject({ status: 2, stdout: '', stderr: 'Usage: node fingerprint.ts <bundle>, in tmdb-proxy/\n' })
  })
})
