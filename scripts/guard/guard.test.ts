import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changes, gitIn, guard, main, options } from './guard.ts'

/**
 * A repository of its own per test: `main` with the files given, then a branch that the test
 * changes. Nothing of this checkout's git config reaches it.
 */
let repo: string

function git(...args: string[]): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }
  const { status, stdout, stderr } = spawnSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { encoding: 'utf8', env })
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${stderr}`)
  return stdout.trim()
}

/** Writes the files (null removes one) and commits them. */
async function commit(files: Record<string, string | null>): Promise<string> {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      await rm(join(repo, path))
    } else {
      await mkdir(dirname(join(repo, path)), { recursive: true })
      await writeFile(join(repo, path), text)
    }
  }
  git('add', '--all')
  git('commit', '--quiet', '--message', 'change')
  return git('rev-parse', '--short', 'HEAD')
}

const CHECKS = JSON.stringify({ coverage: { thresholds: { lines: 96 } } })
const CI = 'jobs:\n  check:\n    steps:\n      - run: npm ci\n      - run: npm run lint\n'
const PLAYWRIGHT = 'export default {\n  retries: 0,\n}\n'

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'kinopeer-guard-'))
  git('init', '--quiet', '--initial-branch', 'main')
  await commit({ 'checks.json': CHECKS, '.github/workflows/ci.yml': CI, 'playwright.config.ts': PLAYWRIGHT, 'src/app.ts': 'export const app = 1\n' })
  git('checkout', '--quiet', '-b', 'branch')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

const run = () => guard({ repo, base: 'main', head: 'branch' })
const said = () => run().found.map(({ needs, file, line, what }) => `${needs} ${file}${line ? `:${line}` : ''}: ${what}`)

describe('guard', () => {
  it('finds nothing in a branch that changes no check', async () => {
    const base = git('rev-parse', '--short', 'main')
    const head = await commit({ 'src/app.ts': 'export const app = 2\n' })
    expect(run()).toEqual({ found: [], report: `<!-- checks-guard -->\n**Checks guard at ${head}**, against \`main\` at ${base}.\n\nNo weakening of the checks and no change to existing ones.` })
  })

  it("reads the thresholds, a workflow and an added line from the branch's commits", async () => {
    await commit({
      'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 90 } } }),
      '.github/workflows/ci.yml': CI.replace('      - run: npm run lint\n', ''),
      'playwright.config.ts': 'export default {\n  workers: 2,\n  retries: 2,\n}\n',
    })
    expect(said()).toEqual([
      'owner .github/workflows/ci.yml: a CI step is removed: `run: npm run lint`',
      'owner checks.json: the threshold `coverage.thresholds.lines` is lowered: `96` → `90`',
      'owner playwright.config.ts:3: test retries appeared: `retries: 2,`',
    ])
  })

  it('sends a removed workflow and a removed thresholds file to the owner', async () => {
    await commit({ 'checks.json': null, '.github/workflows/ci.yml': null })
    expect(said()).toEqual(['owner .github/workflows/ci.yml: the workflow is removed, and its steps with it', 'owner checks.json: the file with the thresholds and the exclusion lists is removed'])
  })

  it('finds nothing in a workflow and a thresholds file the branch adds', async () => {
    await commit({ '.github/workflows/mutants.yml': CI, 'tmdb-proxy/checks.json': '{' })
    expect(said()).toEqual([])
  })

  it('reads a renamed workflow as one removed', async () => {
    git('mv', '.github/workflows/ci.yml', '.github/workflows/checks.yml')
    await commit({})
    expect(said()).toEqual(['owner .github/workflows/ci.yml: the workflow is removed, and its steps with it'])
  })

  it("compares the branch with the commit it left main at, not with what main gained since", async () => {
    await commit({ 'src/app.ts': 'export const app = 2\n' })
    git('checkout', '--quiet', 'main')
    const raised = await commit({ 'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 98 } } }) })
    expect(said()).toEqual([])
    expect(run().report).not.toContain(raised)
  })

  it('names the line of an added line by its place in the file, across hunks', async () => {
    // Eleven lines before the one the second hunk changes, and a line that reads like a hunk's header.
    const config = ['export default {', '  workers: 2,', '  retries: 0,', ...Array.from({ length: 9 }, (_, index) => `  // ${index}`), '  use: {},', '}', ''].join('\n')
    git('checkout', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config })
    git('checkout', '--quiet', 'branch')
    git('merge', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config.replace('  workers: 2,', '  workers: 4,\n@@ -1 +90 @@').replace('  use: {},', '  use: { retries: 1 },') })
    expect(said()).toEqual(['owner playwright.config.ts:14: test retries appeared: `use: { retries: 1 },`'])
  })

  it("reads added lines that look like a diff's own headers as lines of the file", async () => {
    await commit({ 'e2e/notes.ts': '++ b/e2e/other.ts\n@@ -1 +90 @@\nconst config = { retries: 2 }\n' })
    expect(said()).toEqual(['owner e2e/notes.ts:3: test retries appeared: `const config = { retries: 2 }`'])
  })

  it("says so when HEAD is what it reads and the checkout has changes that aren't committed", async () => {
    await commit({ 'src/app.ts': 'export const app = 2\n' })
    await writeFile(join(repo, 'playwright.config.ts'), 'export default {\n  retries: 2,\n}\n')
    const { found, report } = guard({ repo, base: 'main', head: 'HEAD' })
    expect(found).toEqual([])
    expect(report.split('\n').at(-1)).toBe("Uncommitted changes aren't read: commit them and run it again.")
    // A commit named otherwise is what CI reads, where the checkout's state says nothing.
    expect(run().report).not.toContain('Uncommitted')
  })

  it('says nothing of the kind over a clean checkout', async () => {
    await commit({ 'src/app.ts': 'export const app = 2\n' })
    expect(guard({ repo, base: 'main', head: 'HEAD' }).report).not.toContain('Uncommitted')
  })

  it('reads a file whose name has a space or a letter outside ASCII', async () => {
    await commit({ 'e2e/поиск по имени.spec.ts': 'test.describe.configure({ retries: 2 })\n' })
    expect(said()).toEqual(['owner e2e/поиск по имени.spec.ts:1: test retries appeared: `test.describe.configure({ retries: 2 })`'])
  })

  it('fails on a base that is not in the repository', () => {
    expect(() => guard({ repo, base: 'origin/main', head: 'branch' })).toThrow(/git merge-base origin\/main branch/)
  })
})

describe('changes', () => {
  it('gives each changed file once, whole on both sides only where the guard compares it whole', async () => {
    await commit({ 'checks.json': '{}', '.github/workflows/ci.yml': null, '.github/workflows/guard.yml': 'jobs: {}\n', 'src/app.ts': 'export const app = 2\n', 'src/new.ts': 'one\ntwo\n' })
    expect(changes(gitIn(repo), 'main', 'branch')).toEqual([
      { path: '.github/workflows/ci.yml', base: CI, head: undefined, added: [] },
      { path: '.github/workflows/guard.yml', base: undefined, head: 'jobs: {}\n', added: [{ line: 1, text: 'jobs: {}' }] },
      { path: 'checks.json', base: CHECKS, head: '{}', added: [{ line: 1, text: '{}' }] },
      { path: 'src/app.ts', base: undefined, head: undefined, added: [{ line: 1, text: 'export const app = 2' }] },
      { path: 'src/new.ts', base: undefined, head: undefined, added: [{ line: 1, text: 'one' }, { line: 2, text: 'two' }] },
    ])
  })
})

describe('main', () => {
  const args = () => ['--repo', repo, '--base', 'main', '--head', 'branch']

  it('returns the report and, in CI, hands the workflow the counts of each kind', async () => {
    await commit({
      'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 97 } } }),
      'playwright.config.ts': 'export default {\n  retries: 2,\n}\n',
      '.github/workflows/ci.yml': CI.replace('      - run: npm run lint\n', ''),
    })
    const output = join(repo, '..', `${repo.split('/').at(-1)}-output`)
    try {
      expect(main(args(), output)).toBe(run().report)
      expect(await readFile(output, 'utf8')).toBe('owner=2\nreview=1\n')
    } finally {
      await rm(output, { force: true })
    }
  })

  it('writes no counts outside CI', async () => {
    await commit({ 'src/app.ts': 'export const app = 2\n' })
    expect(main(args(), undefined)).toBe(run().report)
  })
})

describe('npm run guard', () => {
  it('prints the report, Node running the TypeScript as it is', async () => {
    await commit({ 'playwright.config.ts': 'export default {\n  retries: 2,\n}\n' })
    const script = fileURLToPath(new URL('./guard.ts', import.meta.url))
    const { status, stdout, stderr } = spawnSync(process.execPath, [script, '--repo', repo, '--base', 'main', '--head', 'branch'], { encoding: 'utf8' })
    expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: `${run().report}\n`, stderr: '' })
  })
})

describe('options', () => {
  it("compares this checkout's HEAD with main's remote branch by default", () => {
    expect(options([])).toEqual({ repo: '.', base: 'origin/main', head: 'HEAD' })
  })

  it('takes the repository, the base and the head from the command line', () => {
    expect(options(['--head', 'abc', '--repo', 'pr', '--base', 'def'])).toEqual({ repo: 'pr', base: 'def', head: 'abc' })
  })

  it('keeps the default for a name without a value', () => {
    expect(options(['--base'])).toEqual({ repo: '.', base: 'origin/main', head: 'HEAD' })
  })
})
