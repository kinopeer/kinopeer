import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { changes, gitIn, guard, main, options } from './guard.ts'
import { approval, secondReview } from './records.ts'

/**
 * A repository of its own per test: `main` with the files given, then a branch that the test
 * changes. The commits are made without this machine's git config; the guard itself reads the
 * repository as it would on that machine, config and all.
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
/** The same config with retries, which the guard marks at its line 2. */
const RETRIES = 'export default {\n  retries: 2,\n}\n'
const RETRIES_FOUND = 'owner playwright.config.ts:2: test retries appeared: `retries: 2,`'
/** A spec of one line with retries, and what the guard says of it under a path. */
const SPEC = 'test.describe.configure({ retries: 2 })\n'
const specFound = (path: string) => `owner ${path}:1: test retries appeared: \`test.describe.configure({ retries: 2 })\``
/** A change the guard has nothing to say about. */
const APP = { 'src/app.ts': 'export const app = 2\n' }
/** What the report ends with when the caller gave no runs of the tests. */
const NO_RUNS = "\n\nThe tests that ran aren't compared: that takes a run of the tests on each side, which CI's `guard` workflow makes."
/** Vitest's report of a run in which these tests of src/sum.test.ts passed. */
const ran = (...titles: string[]) => JSON.stringify({ testResults: [{ name: 'src/sum.test.ts', assertionResults: titles.map((title) => ({ ancestorTitles: [], title, status: 'passed' })) }] })

/** Folders next to the test's repository with the reports of main's run and of the branch's, removed with the test. */
async function reports(base: Record<string, string>, head: Record<string, string>): Promise<{ base: string; head: string }> {
  const folders = { base: `${repo}-tests/base`, head: `${repo}-tests/head` }
  onTestFinished(() => rm(`${repo}-tests`, { recursive: true, force: true }))
  for (const [folder, files] of [[folders.base, base], [folders.head, head]] as const) {
    await mkdir(folder, { recursive: true })
    for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text)
  }
  return folders
}

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
    const head = await commit(APP)
    expect(run()).toEqual({ found: [], report: `<!-- checks-guard -->\n**Checks guard at ${head}**, against \`main\` at ${base}.\n\nNo weakening of the checks and no change to existing ones.${NO_RUNS}`, unmet: false })
  })

  describe("with the PR's comments", () => {
    /** The file the workflow writes the PR's comments to, one a line, here with these members' comments; removed with the test. */
    async function comments(...bodies: string[]): Promise<string> {
      const file = `${repo}-comments`
      onTestFinished(() => rm(file, { force: true }))
      await writeFile(file, bodies.map((body) => JSON.stringify({ association: 'MEMBER', body })).join('\n'))
      return file
    }
    const judged = async (...bodies: string[]) => guard({ repo, base: 'main', head: 'branch', comments: await comments(...bodies) })
    /** The codes the report prints for the two lists. */
    const codes = async () => {
      const { report } = await judged()
      return { owner: /Owner's approval ([0-9a-f]{8})/.exec(report)?.[1] ?? '', review: /Second review ([0-9a-f]{8})/.exec(report)?.[1] ?? '' }
    }
    /** A weakening for the owner (the threshold) and a change for a second review (the type check's config). */
    const BOTH = { 'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 90 } } }), 'tsconfig.json': '{}' }

    it('lets a branch without marks through, with nothing to say of the comments', async () => {
      await commit(APP)
      const { unmet, report } = await judged('Looks fine.')
      expect(unmet).toBe(false)
      expect(report).not.toContain('Comments read')
    })

    it('holds a branch with marks until each list has its record, and says where each stands', async () => {
      await commit(BOTH)
      const { owner, review } = await codes()
      const none = await judged()
      expect(none.unmet).toBe(true)
      expect(none.report).toContain('\n\nComments read for the records: 0, of them from those the owner let into the repository, whose records count: 0.')
      expect(none.report).not.toContain("records aren't read")
      expect(none.report).toContain(`Record to post once the owner approves: \`**Owner's approval ${owner}:** …\`, the reason in the owner's words. Not posted yet.`)
      expect(none.report).toContain(`\`**Second review ${review}: sound**\` or \`**Second review ${review}: weakening**\`. Not posted yet.`)

      expect((await judged(`${approval(owner)} the files it measured are gone`)).unmet).toBe(true)
      expect((await judged(secondReview(review, 'sound'))).unmet).toBe(true)
      const both = await judged(`${approval(owner)} the files it measured are gone`, secondReview(review, 'sound'))
      expect(both.unmet).toBe(false)
      expect(both.report).toContain(`The PR holds the owner's approval of \`${owner}\`.`)
      expect(both.report).toContain(`The PR holds a second review of \`${review}\`: sound.`)
    })

    it('holds it after a second review that found a weakening, until the owner approves that list', async () => {
      await commit({ 'tsconfig.json': '{}' })
      const { review } = await codes()
      expect((await judged(secondReview(review, 'weakening'))).unmet).toBe(true)
      expect((await judged(secondReview(review, 'weakening'), `${approval(review)} strict mode goes with the old compiler`)).unmet).toBe(false)
    })

    it('keeps a record through a commit that touches neither the marks nor the marked files, and not through one that changes a marked file', async () => {
      await commit(BOTH)
      const { owner, review } = await codes()
      const records = [`${approval(owner)} the files it measured are gone`, secondReview(review, 'sound')]
      await commit(APP)
      expect((await judged(...records)).unmet).toBe(false)
      // The same mark, the file marked is another: the second review looked at the one before.
      await commit({ 'tsconfig.json': '{ "strict": false }' })
      const after = await judged(...records)
      expect(after.unmet).toBe(true)
      expect(after.report).toContain(`The PR holds the owner's approval of \`${owner}\`.`)
      expect(after.report).not.toContain(review)
    })

    it('gives a list that marks a removed file its code too', async () => {
      await commit({ 'checks.json': null })
      const { owner } = await codes()
      expect(owner).toMatch(/^[0-9a-f]{8}$/)
      expect((await judged(`${approval(owner)} the thresholds move into the config`)).unmet).toBe(false)
    })

    it("holds a branch with marks when the comments' file isn't there, and not one without marks", async () => {
      await commit(BOTH)
      expect(guard({ repo, base: 'main', head: 'branch', comments: `${repo}-missing` }).unmet).toBe(true)
      await commit({ 'checks.json': CHECKS, 'tsconfig.json': null })
      expect(guard({ repo, base: 'main', head: 'branch', comments: `${repo}-missing` }).unmet).toBe(false)
    })

    it("doesn't count a record from one the owner didn't let into the repository", async () => {
      await commit({ 'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 90 } } }) })
      const { owner } = await codes()
      const file = `${repo}-comments`
      await writeFile(file, [{ association: 'CONTRIBUTOR', body: `${approval(owner)} it is fine` }, { association: 'COLLABORATOR', body: 'Looks fine.' }, { association: 'NONE', body: 'A bot.' }].map((comment) => JSON.stringify(comment)).join('\n'))
      const { unmet, report } = guard({ repo, base: 'main', head: 'branch', comments: file })
      expect(unmet).toBe(true)
      expect(report).toContain('Comments read for the records: 3, of them from those the owner let into the repository, whose records count: 1.')
    })
  })

  it("holds nothing without the PR's comments, prints the records to post and says they weren't read", async () => {
    await commit({ 'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 90 } } }) })
    const { unmet, report } = run()
    expect(unmet).toBe(false)
    expect(report).toMatch(/Record to post once the owner approves: `\*\*Owner's approval [0-9a-f]{8}:\*\* …`, the reason in the owner's words\.\n/)
    expect(report).toContain("\n\nThe PR's records aren't read: CI's `guard` workflow reads them, and says there where each list stands.")
  })

  it('says nothing of the records of a branch without marks', async () => {
    await commit(APP)
    expect(run().report).not.toContain('records')
  })

  it('compares what a test file the branch changes asserts, read from both sides', async () => {
    const spec = (assertion: string) => `test('list', async ({ page }) => {\n${assertion}})\n`
    git('checkout', '--quiet', 'main')
    await commit({ 'e2e/list.spec.ts': spec('  await expect(page).toHaveScreenshot()\n'), 'e2e/__screenshots__/list.png': 'expect(page).toBe(1)\n' })
    git('checkout', '--quiet', '-B', 'branch')
    await commit({ 'e2e/list.spec.ts': `// Nothing to see.\n${spec('')}`, 'e2e/__screenshots__/list.png': 'expect(page).toBe(2)\n' })
    expect(said()).toEqual(['review e2e/list.spec.ts:2: 1 of 1 assertions in `list` rewritten or removed, the first: `expect(page).toHaveScreenshot()`'])
  })

  describe('with the reports of the two runs of the tests', () => {
    it('compares the tests that ran, from every report in the two folders', async () => {
      await commit(APP)
      const list = JSON.stringify({ config: { rootDir: 'e2e' }, suites: [{ title: 'list.spec.ts', specs: [{ title: 'list', file: 'list.spec.ts', tests: [{ expectedStatus: 'passed' }] }] }] })
      const tests = await reports({ 'vitest.json': ran('adds', 'subtracts'), 'playwright.json': list, 'notes.txt': ran('more') }, { 'vitest.json': ran('adds'), 'playwright.json': list.replace('"title":"list"', '"title":"grid"'), 'notes.txt': list })
      // In the order the file system gives the reports in.
      const found = guard({ repo, base: 'main', head: 'branch', tests }).found.toSorted((a, b) => `${a.file}`.localeCompare(`${b.file}`))
      expect(found).toEqual([
        { needs: 'review', file: 'e2e/list.spec.ts', what: '1 of 1 tests main runs here are gone, renamed or no longer run: `list`' },
        { needs: 'owner', file: 'src/sum.test.ts', what: 'fewer tests run: 2 → 1 here, 3 → 2 in all. Gone or no longer run: `subtracts`' },
      ])
    })

    it.each([
      ["the branch's side, for the owner", 'head', 'owner', "the branch's run gave no tests in `vitest.json`, so the guard can't see a test of it that is gone"],
      ["main's side, for a second review", 'base', 'review', "main's run gave no tests in `vitest.json`, so the guard can't see a test of it that is gone"],
    ] as const)('says which report is missing on %s', async (_name, side, needs, what) => {
      await commit(APP)
      const both = { 'vitest.json': ran('adds'), 'playwright.json': ran('list') }
      const tests = await reports(side === 'base' ? { 'playwright.json': ran('list') } : both, side === 'head' ? { 'playwright.json': ran('list') } : both)
      expect(guard({ repo, base: 'main', head: 'branch', tests }).found).toEqual([{ needs, what }])
    })

    it("takes a report it can't read, a folder of that name, for one that gave no tests", async () => {
      await commit(APP)
      const tests = await reports({ 'vitest.json': ran('adds') }, {})
      await mkdir(join(tests.head, 'vitest.json'))
      expect(guard({ repo, base: 'main', head: 'branch', tests }).found).toEqual([{ needs: 'owner', what: "the branch's run gave no tests in `vitest.json`, so the guard can't see a test of it that is gone" }])
    })

    it('says nothing about the runs in its report when the tests are the same', async () => {
      await commit(APP)
      const tests = await reports({ 'vitest.json': ran('adds') }, { 'vitest.json': ran('adds') })
      const { found, report } = guard({ repo, base: 'main', head: 'branch', tests })
      expect(found).toEqual([])
      expect(report).toBe(run().report.replace(NO_RUNS, ''))
    })

    it.each([
      ['there is no such folder', 'missing'],
      ['the folder is empty', 'empty'],
      ['a file sits in place of the folder', 'file'],
    ])("says it can't see for a side where %s", async (_name, folder) => {
      await commit(APP)
      const tests = await reports({ 'vitest.json': ran('adds') }, {})
      await mkdir(`${repo}-tests/empty`)
      await writeFile(`${repo}-tests/file`, ran('adds'))
      expect(guard({ repo, base: 'main', head: 'branch', tests: { ...tests, head: `${repo}-tests/${folder}` } }).found).toEqual([
        { needs: 'owner', what: "the branch's run gave no tests in `vitest.json`, so the guard can't see a test of it that is gone" },
      ])
    })
  })

  it("reads the thresholds, a workflow and an added line from the branch's commits", async () => {
    await commit({
      'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 90 } } }),
      '.github/workflows/ci.yml': CI.replace('      - run: npm run lint\n', ''),
      'playwright.config.ts': 'export default {\n  workers: 2,\n  retries: 2,\n}\n',
    })
    expect(said()).toEqual([
      'owner checks.json: the threshold `coverage.thresholds.lines` is lowered: `96` → `90`',
      'owner playwright.config.ts:3: test retries appeared: `retries: 2,`',
      'owner .github/workflows/ci.yml: a command CI ran is no longer run: `npm run lint`',
    ])
  })

  it('sends a removed workflow and a removed thresholds file to the owner', async () => {
    await commit({ 'checks.json': null, '.github/workflows/ci.yml': null })
    expect(said()).toEqual([
      'owner checks.json: the file with the thresholds and the exclusion lists is removed',
      'owner .github/workflows/ci.yml: the workflow is removed, and its steps with it',
      'owner .github/workflows/ci.yml: a command CI ran is no longer run: `npm ci`',
      'owner .github/workflows/ci.yml: a command CI ran is no longer run: `npm run lint`',
    ])
  })

  it('finds nothing in a workflow and a thresholds file the branch adds', async () => {
    await commit({ '.github/workflows/mutants.yml': CI, 'tmdb-proxy/checks.json': '{' })
    expect(said()).toEqual([])
  })

  it('reads a renamed workflow as one removed', async () => {
    git('mv', '.github/workflows/ci.yml', '.github/workflows/checks.yml')
    await commit({})
    expect(said()).toEqual(['owner .github/workflows/ci.yml: the workflow is removed, and its steps with it'])
    // Its commands still run, in the workflow under the new name, which the branch changes too.
  })

  it("compares the branch with the commit it left main at, not with what main gained since", async () => {
    await commit(APP)
    git('checkout', '--quiet', 'main')
    const raised = await commit({ 'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 98 } } }) })
    expect(said()).toEqual([])
    expect(run().report).not.toContain(raised)
  })

  it.each<[string, () => void]>([
    ['as git is by default', () => {}],
    ['with the lines between hunks shown, by its config', () => git('config', 'diff.interHunkContext', '20')],
    ['with lines around each hunk shown, by its environment', () => vi.stubEnv('GIT_DIFF_OPTS', '--unified=3')],
  ])('names the line of an added line by its place in the file, across hunks, %s', async (_name, configure) => {
    // Eleven lines before the one the second hunk changes, and a line that reads like a hunk's header.
    const config = ['export default {', '  workers: 2,', '  retries: 0,', ...Array.from({ length: 9 }, (_, index) => `  // ${index}`), '  use: {},', '}', ''].join('\n')
    git('checkout', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config })
    git('checkout', '--quiet', 'branch')
    git('merge', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config.replace('  workers: 2,', '  workers: 4,\n@@ -1 +90 @@').replace('  use: {},', '  use: { retries: 1 },') })
    configure()
    expect(said()).toEqual(['owner playwright.config.ts:14: test retries appeared: `use: { retries: 1 },`'])
  })

  it.each<[string, () => void]>([
    ['between hunks, by its config', () => git('config', 'diff.interHunkContext', '20')],
    ['around each hunk, by its environment', () => vi.stubEnv('GIT_DIFF_OPTS', '--unified=3')],
  ])('counts a blank line of context that git shows as an empty line, %s', async (_name, configure) => {
    // A blank line between the two changes, and one right after the second.
    const config = ['export default {', '  workers: 2,', '', '  // one', '  retries: 0,', '', '}', ''].join('\n')
    git('checkout', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config })
    git('checkout', '--quiet', 'branch')
    git('merge', '--quiet', 'main')
    await commit({ 'playwright.config.ts': config.replace('  workers: 2,', '  workers: 4,').replace('  retries: 0,', '  retries: 1,') })
    // A blank line of context without the space that otherwise starts a line of context.
    git('config', 'diff.suppressBlankEmpty', 'true')
    configure()
    expect(said()).toEqual(['owner playwright.config.ts:5: test retries appeared: `retries: 1,`'])
  })

  it("reads added lines that look like a diff's own headers as lines of the file", async () => {
    await commit({ 'e2e/notes.ts': '++ b/e2e/other.ts\n@@ -1 +90 @@\nconst config = { retries: 2 }\n' })
    expect(said()).toEqual(['owner e2e/notes.ts:3: test retries appeared: `const config = { retries: 2 }`'])
  })

  it("says so when HEAD is what it reads and the checkout has changes that aren't committed", async () => {
    await commit(APP)
    await writeFile(join(repo, 'playwright.config.ts'), RETRIES)
    const { found, report } = guard({ repo, base: 'main', head: 'HEAD' })
    expect(found).toEqual([])
    expect(report.split('\n').at(-1)).toBe("Uncommitted changes aren't read: commit them and run it again.")
    // A commit named otherwise is what CI reads, where the checkout's state says nothing.
    expect(run().report).not.toContain('Uncommitted')
  })

  it('says nothing of the kind over a clean checkout', async () => {
    await commit(APP)
    expect(guard({ repo, base: 'main', head: 'HEAD' }).report).not.toContain('Uncommitted')
  })

  it('reads a file whose name has a space or a letter outside ASCII', async () => {
    await commit({ 'e2e/поиск по имени.spec.ts': SPEC })
    expect(said()).toEqual([specFound('e2e/поиск по имени.spec.ts')])
  })

  it.each([
    ['colors its diffs', ['color.ui', 'always']],
    ['hands its diffs to another program', ['diff.external', 'true']],
  ])('reads the added lines in a repository whose git config %s', async (_name, config) => {
    git('config', ...config)
    await commit({ 'playwright.config.ts': RETRIES })
    expect(said()).toEqual([RETRIES_FOUND])
  })

  it.each([
    ['not to be shown in diffs', 'playwright.config.ts -diff\n'],
    ['binary', 'playwright.config.ts binary\n'],
  ])("reads the added lines of a file the branch's .gitattributes marks as %s", async (_name, attributes) => {
    await commit({ 'playwright.config.ts': RETRIES, '.gitattributes': attributes })
    expect(said()).toEqual([RETRIES_FOUND])
  })

  it('reads the added lines of a file that git is told to convert before it diffs it', async () => {
    git('config', 'diff.hidden.textconv', 'true')
    await commit({ 'playwright.config.ts': RETRIES, '.gitattributes': 'playwright.config.ts diff=hidden\n' })
    expect(said()).toEqual([RETRIES_FOUND])
  })

  it('reads a path with the characters of a pattern as that one file', async () => {
    // The other file's line differs, so a line read from it under the first one's name would show.
    await commit({ 'e2e/[id].spec.ts': SPEC, 'e2e/i.spec.ts': 'export const retries = 3\n' })
    expect(said()).toEqual([specFound('e2e/[id].spec.ts'), 'owner e2e/i.spec.ts:1: test retries appeared: `export const retries = 3`'])
  })

  it('fails on a base that is not in the repository', () => {
    expect(() => guard({ repo, base: 'origin/main', head: 'branch' })).toThrow(/git merge-base origin\/main branch/)
  })
})

describe('changes', () => {
  it('gives each changed file once, whole on both sides only where the guard compares it whole', async () => {
    await commit({ 'checks.json': '{}', '.github/workflows/ci.yml': null, '.github/workflows/guard.yml': 'jobs: {}\n', 'src/app.ts': 'export const app = 2\n', 'src/new.ts': 'one\ntwo\n', 'src/new.test.ts': 'three\n' })
    expect(changes(gitIn(repo), 'main', 'branch')).toEqual([
      { path: '.github/workflows/ci.yml', base: CI, head: undefined, added: [] },
      { path: '.github/workflows/guard.yml', base: undefined, head: 'jobs: {}\n', added: [{ line: 1, text: 'jobs: {}' }] },
      { path: 'checks.json', base: CHECKS, head: '{}', added: [{ line: 1, text: '{}' }] },
      { path: 'src/app.ts', base: undefined, head: undefined, added: [{ line: 1, text: 'export const app = 2' }] },
      { path: 'src/new.test.ts', base: undefined, head: 'three\n', added: [{ line: 1, text: 'three' }] },
      { path: 'src/new.ts', base: undefined, head: undefined, added: [{ line: 1, text: 'one' }, { line: 2, text: 'two' }] },
    ])
  })
})

/** A file next to the test's repository for the counts CI's workflow reads, removed with the test. */
async function outputFile(): Promise<string> {
  const output = `${repo}-output`
  onTestFinished(() => rm(output, { force: true }))
  return output
}

describe('main', () => {
  const args = () => ['--repo', repo, '--base', 'main', '--head', 'branch']

  it('returns the report and, in CI, hands the workflow the counts of each kind', async () => {
    await commit({
      'checks.json': JSON.stringify({ coverage: { thresholds: { lines: 97 } } }),
      'playwright.config.ts': RETRIES,
      '.github/workflows/ci.yml': CI.replace('      - run: npm run lint\n', ''),
    })
    const output = await outputFile()
    expect(main(args(), { GITHUB_OUTPUT: output })).toBe(run().report)
    expect(await readFile(output, 'utf8')).toBe('owner=2\nreview=1\nunmet=false\n')
  })

  it("tells the workflow that a record is missing when the command line names the PR's comments", async () => {
    await commit({ 'playwright.config.ts': RETRIES })
    const output = await outputFile()
    const comments = `${repo}-comments`
    onTestFinished(() => rm(comments, { force: true }))
    await writeFile(comments, '')
    expect(main([...args(), '--comments', comments], { GITHUB_OUTPUT: output })).toContain('Not posted yet.')
    expect(await readFile(output, 'utf8')).toBe('owner=1\nreview=0\nunmet=true\n')
  })

  it('returns the report outside CI, where there is no file for the counts', async () => {
    await commit(APP)
    // With nothing named to write to, writing at all would throw.
    expect(main(args(), {})).toBe(run().report)
  })

  it('compares the tests that ran when the command line names the folders of the two runs', async () => {
    await commit(APP)
    const tests = await reports({ 'vitest.json': ran('adds', 'subtracts') }, { 'vitest.json': ran('adds') })
    const output = await outputFile()
    expect(main([...args(), '--tests-base', tests.base, '--tests-head', tests.head], { GITHUB_OUTPUT: output })).toContain('- `src/sum.test.ts`: fewer tests run: 2 → 1 here, 2 → 1 in all.')
    expect(await readFile(output, 'utf8')).toBe('owner=1\nreview=0\nunmet=false\n')
  })
})

describe('npm run guard', () => {
  const script = fileURLToPath(new URL('./guard.ts', import.meta.url))
  /** The script as a process, with a file of the test's own for the counts, whatever this run's environment names. */
  const start = (path: string, output: string) =>
    spawnSync(process.execPath, [path, '--repo', repo, '--base', 'main', '--head', 'branch'], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } })

  it('prints the report and writes the counts, Node running the TypeScript as it is', async () => {
    await commit({ 'playwright.config.ts': RETRIES })
    const output = await outputFile()
    const { status, stdout, stderr } = start(script, output)
    expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: `${run().report}\n`, stderr: '' })
    expect(await readFile(output, 'utf8')).toBe('owner=1\nreview=0\nunmet=false\n')
  })

  it('runs through a folder that is a link to its own', async () => {
    await commit({ 'playwright.config.ts': RETRIES })
    const link = `${repo}-link`
    onTestFinished(() => rm(link, { force: true }))
    await symlink(dirname(script), link)
    expect(start(join(link, 'guard.ts'), await outputFile()).stdout).toBe(`${run().report}\n`)
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

  it("takes the file of the PR's comments from the command line, and none by default", () => {
    expect(options(['--comments', 'comments.jsonl']).comments).toBe('comments.jsonl')
    expect(options([])).not.toHaveProperty('comments')
  })

  it('takes the folders of the two runs of the tests from the command line', () => {
    expect(options(['--tests-head', 'lists/pr', '--tests-base', 'lists/base']).tests).toEqual({ base: 'lists/base', head: 'lists/pr' })
  })

  it.each([
    ["main's", ['--tests-base', 'lists/base'], { base: 'lists/base', head: '' }],
    ["the branch's", ['--tests-head', 'lists/pr'], { base: '', head: 'lists/pr' }],
  ])('compares the tests with only %s folder named, the other side having no list', (_name, args, tests) => {
    expect(options(args).tests).toEqual(tests)
  })
})
