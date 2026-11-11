import { describe, expect, it } from 'vitest'
import { compareTests, testsIn, type Test } from './tests.ts'

const json = (value: unknown) => JSON.stringify(value)
const said = (base: Test[], head: Test[]) => compareTests(base, head).map(({ needs, file, what }) => `${needs} ${file ?? ''}: ${what}`)
/** Tests of one file by their names. */
const tests = (file: string, ...names: string[]): Test[] => names.map((name) => ({ file, name }))

describe('testsIn', () => {
  /** A test as Vitest's JSON reporter gives it. */
  const result = (title: string, status: string, ancestorTitles: string[] = []) => ({ ancestorTitles, fullName: [...ancestorTitles, title].join(' '), status, title })

  it("gives the tests of Vitest's report that ran, each by its file and its name with its groups'", () => {
    const report = {
      numTotalTests: 4,
      testResults: [
        { name: 'src/sum.test.ts', assertionResults: [result('adds', 'passed', ['sum', 'of two']), result('subtracts', 'failed', ['sum'])] },
        { name: 'server/main.test.ts', assertionResults: [result('starts', 'passed')] },
      ],
    }
    expect(testsIn(json(report))).toEqual([
      { file: 'src/sum.test.ts', name: 'sum › of two › adds' },
      { file: 'src/sum.test.ts', name: 'sum › subtracts' },
      { file: 'server/main.test.ts', name: 'starts' },
    ])
  })

  it.each(['skipped', 'pending', 'todo'])("doesn't count a test of Vitest's that is %s", (status) => {
    expect(testsIn(json({ testResults: [{ name: 'src/sum.test.ts', assertionResults: [result('adds', status), result('subtracts', 'passed')] }] }))).toEqual(tests('src/sum.test.ts', 'subtracts'))
  })

  /** A test as Playwright's list gives it, once per project it runs in. */
  const spec = (title: string, file: string, ...expected: string[]) => ({ title, file, tests: expected.map((expectedStatus) => ({ expectedStatus, status: 'skipped' })) })

  it("gives the tests of Playwright's list, each by its file under the tests' folder and its name with its groups'", () => {
    const report = {
      config: { rootDir: 'e2e' },
      suites: [
        {
          title: 'downloads.spec.ts',
          file: 'downloads.spec.ts',
          specs: [spec('alone', 'downloads.spec.ts', 'passed')],
          suites: [{ title: 'phone', specs: [spec('list', 'downloads.spec.ts', 'passed')], suites: [{ title: 'dark', specs: [spec('grid', 'downloads.spec.ts', 'passed')] }] }],
        },
        { title: 'smoke/tabs.smoke.ts', file: 'smoke/tabs.smoke.ts', specs: [spec('tabs', 'smoke/tabs.smoke.ts', 'passed')] },
      ],
    }
    expect(testsIn(json(report))).toEqual([
      { file: 'e2e/downloads.spec.ts', name: 'alone' },
      { file: 'e2e/downloads.spec.ts', name: 'phone › list' },
      { file: 'e2e/downloads.spec.ts', name: 'phone › dark › grid' },
      { file: 'e2e/smoke/tabs.smoke.ts', name: 'tabs' },
    ])
  })

  it("counts a test of Playwright's once per project it runs in, and not where it is skipped", () => {
    const suites = [{ title: 'a.spec.ts', specs: [spec('both', 'a.spec.ts', 'passed', 'passed'), spec('one', 'a.spec.ts', 'passed', 'skipped'), spec('none', 'a.spec.ts', 'skipped'), spec('fails', 'a.spec.ts', 'failed')] }]
    expect(testsIn(json({ config: { rootDir: 'e2e' }, suites }))).toEqual(tests('e2e/a.spec.ts', 'both', 'both', 'one', 'fails'))
  })

  it("names a file of Playwright's as the list has it when the list doesn't say where the tests are", () => {
    expect(testsIn(json({ suites: [{ title: 'a.spec.ts', specs: [spec('one', 'a.spec.ts', 'passed')] }] }))).toEqual(tests('a.spec.ts', 'one'))
  })

  it.each([
    ['is not JSON', 'Error: no tests found'],
    ['is cut short', '{"testResults":[{"name":"src/sum.test.ts","assertionResults":['],
    ['is not an object', '[]'],
    ['is null', 'null'],
    ['is neither a run nor a list', '{"version":1}'],
    ['holds something else where the tests are', json({ testResults: [null, { name: 'src/sum.test.ts', assertionResults: 'none' }, { name: 'src/sum.test.ts' }, { name: 'src/sum.test.ts', assertionResults: [null, 'adds'] }] })],
    ["holds something else where Playwright's tests are", json({ config: null, suites: [null, { specs: [null, { title: 'one', tests: 'none' }], suites: 'none' }] })],
  ])('gives no tests for a report that %s', (_name, report) => {
    expect(testsIn(report)).toEqual([])
  })
})

describe('compareTests', () => {
  const sum = tests('src/sum.test.ts', 'adds', 'subtracts')
  const other = tests('src/other.test.ts', 'works')

  it.each([
    ['the same tests in another order', [...other, ...sum], [...sum].reverse().concat(other)],
    ['a test added', [...sum, ...other], [...sum, ...other, ...tests('src/sum.test.ts', 'multiplies')]],
    ['a file of tests added', sum, [...sum, ...other]],
  ])('finds nothing in %s', (_name, base, head) => {
    expect(said(base, head)).toEqual([])
  })

  it('sends a test that is gone to the owner when the branch runs fewer tests, in its file and in all', () => {
    expect(said([...sum, ...other], [...tests('src/sum.test.ts', 'adds'), ...other])).toEqual(['owner src/sum.test.ts: fewer tests run: 2 → 1 here, 3 → 2 in all. Gone or no longer run: `subtracts`'])
  })

  it('sends a file whose tests are all gone to the owner', () => {
    expect(said([...sum, ...other], other)).toEqual(['owner src/sum.test.ts: fewer tests run: 2 → 0 here, 3 → 1 in all. Gone or no longer run: `adds`, `subtracts`'])
  })

  it.each([
    ['a test renamed', [...sum, ...other], [...tests('src/sum.test.ts', 'adds', 'takes away'), ...other], ['review src/sum.test.ts: 1 of 2 tests main runs here are gone, renamed or no longer run: `subtracts`']],
    ['a test gone from a file while another file gained one', [...sum, ...other], [...tests('src/sum.test.ts', 'adds'), ...other, ...tests('src/other.test.ts', 'works again')], ['review src/sum.test.ts: 1 of 2 tests main runs here are gone, renamed or no longer run: `subtracts`']],
    ['a file of tests moved', [...sum, ...other], [...tests('src/lib/sum.test.ts', 'adds', 'subtracts'), ...other], ['review src/sum.test.ts: 2 of 2 tests main runs here are gone, renamed or no longer run: `adds`, `subtracts`']],
  ])('sends %s to a second review, the branch running no fewer tests', (_name, base, head, found) => {
    expect(said(base, head)).toEqual(found)
  })

  it('sends a renamed test to a second review in a branch that runs fewer tests elsewhere', () => {
    expect(said([...sum, ...other], tests('src/sum.test.ts', 'adds', 'takes away'))).toEqual([
      'review src/sum.test.ts: 1 of 2 tests main runs here are gone, renamed or no longer run: `subtracts`',
      'owner src/other.test.ts: fewer tests run: 1 → 0 here, 3 → 2 in all. Gone or no longer run: `works`',
    ])
  })

  it('counts two tests of one name in a file as two, so one of them gone is seen', () => {
    expect(said(tests('src/sum.test.ts', 'adds', 'adds'), tests('src/sum.test.ts', 'adds'))).toEqual(['owner src/sum.test.ts: fewer tests run: 2 → 1 here, 2 → 1 in all. Gone or no longer run: `adds`'])
  })

  it("doesn't take a test of the same name in another file for the one that is gone", () => {
    expect(said([...tests('src/a.test.ts', 'works'), ...other], other)).toEqual(['owner src/a.test.ts: fewer tests run: 1 → 0 here, 2 → 1 in all. Gone or no longer run: `works`'])
  })

  it('names ten of the tests gone from a file and counts the rest', () => {
    const names = Array.from({ length: 12 }, (_, index) => `test ${index + 1}`)
    const [found] = said([...tests('src/sum.test.ts', ...names), ...other], other)
    expect(found).toBe(`owner src/sum.test.ts: fewer tests run: 12 → 0 here, 13 → 1 in all. Gone or no longer run: ${names.slice(0, 10).map((name) => `\`${name}\``).join(', ')} and 2 more`)
    expect(said([...tests('src/sum.test.ts', ...names.slice(0, 10)), ...other], other)[0]).not.toContain('more')
  })

  it.each([
    ["the branch's run gave no tests", sum, [], ["owner : the branch's run gave no list of its tests, so the guard can't see a test that is gone"]],
    ["main's run gave no tests", [], sum, ["review : main's run gave no list of its tests, so the guard can't see a test that is gone"]],
    ['neither run gave any', [], [], ["owner : the branch's run gave no list of its tests, so the guard can't see a test that is gone"]],
  ])("says it can't see when %s", (_name, base, head, found) => {
    expect(said(base, head)).toEqual(found)
  })
})
