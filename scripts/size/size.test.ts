import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { builtFiles, main, options } from './size.ts'

/** A folder of its own per test, with a build in `dist` and the budgets in `checks.json`. */
let root: string
const at = (path: string) => join(root, path)
const args = (dist = at('dist'), checks = at('checks.json')) => ['node', 'size.ts', '--dist', dist, '--checks', checks]

const JS = 'export const app = "' + 'kinopeer '.repeat(200) + '"\n'
const CSS = '.ks-row { color: red }\n'.repeat(50)
const FONT = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

async function write(files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(at(path), '..'), { recursive: true })
    await writeFile(at(path), content)
  }
}

const budgets = (size: object) => JSON.stringify({ coverage: {}, budgets: { size } })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'size-'))
  await write({ 'dist/assets/index-Ab12.js': JS, 'dist/assets/index-Ab12.css': CSS, 'dist/assets/font-Ab12.woff2': FONT, 'dist/index.html': '<!doctype html>' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('builtFiles', () => {
  it('reads every file under the folder, JS and CSS gzipped and the rest as it is', () => {
    const files = builtFiles(at('dist')).sort((a, b) => a.path.localeCompare(b.path))
    expect(files).toEqual([
      { path: 'assets/font-Ab12.woff2', size: FONT.length },
      { path: 'assets/index-Ab12.css', size: gzipSync(CSS).length },
      { path: 'assets/index-Ab12.js', size: gzipSync(JS).length },
      { path: 'index.html', size: '<!doctype html>'.length },
    ])
    // Gzipped, not as written: the text repeats, so it shrinks.
    expect(gzipSync(JS).length).toBeLessThan(JS.length)
  })

  it('throws for a folder that is not there', () => {
    expect(() => builtFiles(at('nothing'))).toThrow(/ENOENT/)
  })
})

describe('options', () => {
  it('reads the build folder and the budgets file from the command line', () => {
    expect(options(['node', 'size.ts', '--checks', 'c.json', '--dist', 'build'])).toEqual({ dist: 'build', checks: 'c.json' })
  })

  it('takes dist/ and checks.json when neither is given', () => {
    expect(options(['node', 'size.ts'])).toEqual({ dist: 'dist', checks: 'checks.json' })
  })

  it('takes the default for an option given without its value', () => {
    expect(options(['node', 'size.ts', '--dist'])).toEqual({ dist: 'dist', checks: 'checks.json' })
  })
})

describe('main', () => {
  const sizes = () => ({ js: gzipSync(JS).length, css: gzipSync(CSS).length, rest: FONT.length + '<!doctype html>'.length })

  it('passes a build within its budgets and adds the report to the job summary', async () => {
    await write({ 'checks.json': budgets(sizes()), 'summary.md': '# Earlier step\n' })
    const verdict = main(args(), { GITHUB_STEP_SUMMARY: at('summary.md') })
    expect(verdict.passed).toBe(true)
    expect(verdict.report).toContain(`| JS, gzipped | ${sizes().js.toLocaleString('en-US')} B | ${sizes().js.toLocaleString('en-US')} B | 0 B |`)
    expect(await readFile(at('summary.md'), 'utf8')).toBe(`# Earlier step\n${verdict.report}\n`)
  })

  it('fails a build over a budget', async () => {
    await write({ 'checks.json': budgets({ ...sizes(), css: sizes().css - 1 }) })
    const verdict = main(args(), {})
    expect(verdict.passed).toBe(false)
    expect(verdict.report).toContain('**CSS is over its budget by 1 B**')
  })

  it('fails a build folder that is missing, and says to build first', async () => {
    await write({ 'checks.json': budgets(sizes()) })
    const verdict = main(args(at('nothing')), {})
    expect(verdict.passed).toBe(false)
    expect(verdict.report).toContain(`- the build in \`${at('nothing')}\` can't be read (run \`npm run build\` first): ENOENT`)
  })

  it('fails an empty build folder', async () => {
    await mkdir(at('empty'))
    await write({ 'checks.json': budgets(sizes()) })
    const verdict = main(args(at('empty')), {})
    expect(verdict).toEqual({ passed: false, report: "## Build size\n\nThe size couldn't be checked:\n\n- the build has no files: run `npm run build` first" })
  })

  it.each([
    ['missing', undefined],
    ['not JSON', '{ "budgets": '],
  ])('fails a checks file that is %s', async (_name, text) => {
    if (text !== undefined) await write({ 'checks.json': text })
    const verdict = main(args(), {})
    expect(verdict.passed).toBe(false)
    expect(verdict.report).toContain(`- \`${at('checks.json')}\` can't be read as JSON: `)
  })

  it('fails a budget that is missing, saying which', async () => {
    await write({ 'checks.json': budgets({ js: 1000, css: 1000 }) })
    const verdict = main(args(), {})
    expect(verdict.passed).toBe(false)
    expect(verdict.report).toContain('- `budgets.size.rest` in checks.json is missing')
  })

  it('names every problem at once: the build and the budgets', async () => {
    await write({ 'checks.json': budgets({}) })
    const { report } = main(args(at('nothing')), {})
    expect(report).toContain(`- the build in \`${at('nothing')}\` can't be read`)
    expect(report).toContain('`budgets.size.js` in checks.json is missing')
  })
})
