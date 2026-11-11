import { describe, expect, it } from 'vitest'
import { asserted, compareAssertions } from './assertions.ts'

/** What a file's tests assert, as plain pairs of a name and its items. */
const items = (text: string, path = 'src/a.test.ts') => [...(asserted(path, text) ?? [])].map(([name, { items: list }]) => [name, list])
const lines = (text: string) => [...(asserted('src/a.test.ts', text) ?? [])].map(([name, { line }]) => [name, line])
/** A test file of one test with this body. */
const test = (body: string) => `it('adds', () => {\n${body}\n})\n`
const said = (base: string | undefined, head: string | undefined, path = 'src/a.test.ts') =>
  compareAssertions(path, base, head).map(({ needs, file, line, what }) => `${needs} ${file}${line ? `:${line}` : ''}: ${what}`)

describe('asserted', () => {
  it('gives each test by its name with its groups’, and the line it starts at', () => {
    const text = "describe('sum', () => {\n  describe('of two', () => {\n    it('adds', () => {\n      expect(sum(1, 2)).toBe(3)\n    })\n  })\n  test('subtracts', () => {})\n})\nit('alone', () => {})\n"
    expect(items(text)).toEqual([
      ['sum › of two › adds', ['expect(sum(1, 2)).toBe(3)']],
      ['sum › subtracts', []],
      ['alone', []],
    ])
    expect(lines(text)).toEqual([
      ['sum › of two › adds', 3],
      ['sum › subtracts', 7],
      ['alone', 9],
    ])
  })

  it.each([
    ['a call on expect', 'expect(a).toBe(1)', ['expect(a).toBe(1)']],
    ['a call on what expect gives, awaited', 'await expect(load()).rejects.toThrow()', ['expect(load()).rejects.toThrow()']],
    ['a call on assert', "assert.equal(a, 1, 'one')", ["assert.equal(a, 1, 'one')"]],
    ['assert called itself', 'assert(a)', ['assert(a)']],
    ['what is built on expect by its name', 'expectTypeOf(a).toBeString()\nexpectRow(1)', ['expectTypeOf(a).toBeString()', 'expectRow(1)']],
    ['an assertion inside a callback', 'await waitFor(() => {\n  expect(a).toBe(1)\n})', ['expect(a).toBe(1)']],
    ['an assertion inside a call on something that is not a name', '[1, 2].forEach((a) => {\n  expect(sum(a)).toBe(a)\n})\nthis.check()', ['expect(sum(a)).toBe(a)']],
    ['an assertion after a list taken apart with a gap', 'const [, b] = pair\nexpect(b).toBe(1)', ['expect(b).toBe(1)']],
    ['an assertion in a loop that counts', 'for (let i = 0; i < 2; i++) expect(sum(i)).toBe(i)', ['expect(sum(i)).toBe(i)']],
    ['an assertion handed to another call', 'run(expect(a))', ['expect(a)']],
    ['an assertion over several lines as one line', 'expect(a).toEqual({\n    b: 1,\n  })', ['expect(a).toEqual({ b: 1, })']],
    ['an assertion with a matcher of expect’s inside it, as one', 'expect(a).toEqual(expect.any(String))', ['expect(a).toEqual(expect.any(String))']],
    ['each of the same assertion written twice', 'expect(a).toBe(1)\nexpect(a).toBe(1)', ['expect(a).toBe(1)', 'expect(a).toBe(1)']],
  ])('takes %s', (_name, body, found) => {
    expect(items(`it('adds', async () => {\n${body}\n})\n`)).toEqual([['adds', found]])
  })

  it.each(["screen.getByRole('button')", 'unexpected(a)', 'reassert(a)', 'vi.expect(a)', 'const expected = 1', 'check(a).expect(1)'])("doesn't take %s for an assertion", (body) => {
    expect(items(test(body))).toEqual([['adds', []]])
  })

  it.each([
    ['a hook', "beforeEach(() => {\n  expect(a).toBe(1)\n})\nit('adds', () => {})\n"],
    ['a helper', "function check() {\n  expect(a).toBe(1)\n}\nit('adds', () => {})\n"],
    ['a hook of Playwright’s', "test.beforeEach(async () => {\n  expect(a).toBe(1)\n})\ntest('adds', () => {})\n"],
  ])('keeps what %s asserts apart from the tests', (_name, text) => {
    expect(items(text)).toEqual([
      ['', ['expect(a).toBe(1)']],
      ['adds', []],
    ])
  })

  it.each([
    ['it.skip', "it.skip('adds', () => {\n  expect(a).toBe(1)\n})\n"],
    ['it.only', "it.only('adds', () => {\n  expect(a).toBe(1)\n})\n"],
    ['test.concurrent', "test.concurrent('adds', async () => {\n  expect(a).toBe(1)\n})\n"],
    ['a function written out', "it('adds', function () {\n  expect(a).toBe(1)\n})\n"],
    ['options between the title and the function', "it('adds', { timeout: 100 }, () => {\n  expect(a).toBe(1)\n})\n"],
  ])('takes %s for a test', (_name, text) => {
    expect(items(text)).toEqual([['adds', ['expect(a).toBe(1)']]])
  })

  it('reads Playwright’s groups and tests, a step being a part of its test', () => {
    const text = "test.describe('downloads', () => {\n  test('list', async ({ page }) => {\n    await test.step('opens', async () => {\n      await expect(page).toHaveScreenshot()\n    })\n  })\n})\nsuite('more', () => {\n  test('grid', () => {})\n})\n"
    expect(items(text, 'e2e/downloads.spec.ts')).toEqual([
      ['downloads › list', ['expect(page).toHaveScreenshot()']],
      ['more › grid', []],
    ])
  })

  it.each([
    ['a call with a title and no function', "it('adds')\nit.todo('subtracts')\n"],
    ['a call with a function and no title', 'test(() => {})\ndescribe(() => {})\n'],
    ['a call on another name', "bench('adds', () => {})\nmy.it('adds', () => {})\n"],
  ])("doesn't take %s for a test", (_name, text) => {
    expect(items(text)).toEqual([])
  })

  it('names a test whose title is not a string by the title as written', () => {
    expect(items('it(`adds ${one}`, () => {})\nit(name, () => {})\n')).toEqual([
      ['`adds ${one}`', []],
      ['name', []],
    ])
  })

  it('joins what two tests of one name assert, at the line of the first', () => {
    const text = "it('adds', () => {\n  expect(a).toBe(1)\n})\nit('adds', () => {\n  expect(b).toBe(2)\n})\n"
    expect(items(text)).toEqual([['adds', ['expect(a).toBe(1)', 'expect(b).toBe(2)']]])
    expect(lines(text)).toEqual([['adds', 1]])
  })

  describe('a table', () => {
    const body = "('adds %s', (a, b) => {\n  expect(sum(a)).toBe(b)\n})\n"
    const found = ['row [1, 2]', "row ['two', 4]", 'expect(sum(a)).toBe(b)']

    it.each([
      ['given in place', `it.each([[1, 2], ['two', 4]])${body}`],
      ['given in place over several lines, as a constant', `it.each([\n  [1, 2],\n  ['two', 4],\n] as const)${body}`],
      ['of it.for', `it.for([[1, 2], ['two', 4]])${body}`],
      ['after a modifier', `it.concurrent.each([[1, 2], ['two', 4]])${body}`],
      ['given in place, in a file that takes another list apart', `const [one, two] = [1, 2]\nit.each([[1, 2], ['two', 4]])${body}`],
      ['given in place with a gap', `it.each([[1, 2], , ['two', 4]])${body}`],
      ['given by a name that is declared without a value first', `let rows: Row[]\nconst ROWS = [[1, 2], ['two', 4]]\nit.each(ROWS)${body}`],
      ['given in place behind a type', `it.each(<Row[]>[[1, 2], ['two', 4]])${body}`],
      ['given by the name of a list', `const ROWS = [[1, 2], ['two', 4]]\nit.each(ROWS)${body}`],
      ['given by the name of a list behind a type', `const ROWS = [[1, 2], ['two', 4]]\nit.each(ROWS as Row[])${body}`],
      ['given by the name of a list declared as a constant of a type', `const ROWS = [[1, 2], ['two', 4]] as const satisfies Row[]\nit.each(ROWS)${body}`],
      ['given by the name of a list declared after the test, inside a group', `describe('sum', () => {\n  it.each(ROWS)${body}  const ROWS: Row[] = [[1, 2], ['two', 4]]\n})\n`],
    ])('gives the rows of one %s among what the test asserts', (_name, text) => {
      expect(items(text).map(([, list]) => list)).toEqual([found])
    })

    it.each([
      ['an imported one', 'it.each(ROWS)', 'table ROWS'],
      ['a computed one', 'it.each(Object.keys(ROWS))', 'table Object.keys(ROWS)'],
      ['one whose name holds something else', 'const ROWS = rows()\nit.each(ROWS)', 'table ROWS'],
      ['one written as a template', 'it.each`\n  a | b\n  ${1} | ${2}\n`', 'table ` a | b ${1} | ${2} `'],
    ])("gives a table it can't open, %s, as written", (_name, table, item) => {
      expect(items(`${table}${body}`)).toEqual([['adds %s', [item, 'expect(sum(a)).toBe(b)']]])
    })

    it('gives the rows of a group’s table under the group’s name', () => {
      expect(items(`describe.each([1, 2])('sum of %s', (a) => {\n  it('adds', () => {\n    expect(sum(a)).toBe(a)\n  })\n})\n`)).toEqual([
        ['sum of %s', ['row 1', 'row 2']],
        ['sum of %s › adds', ['expect(sum(a)).toBe(a)']],
      ])
    })

    it("doesn't take the argument of another call before the title for a table", () => {
      expect(items(`it.extend({ a: 1 })${body}`)).toEqual([['adds %s', ['expect(sum(a)).toBe(b)']]])
    })
  })

  it('reads TypeScript and, in a .tsx file, JSX', () => {
    expect(items("it('renders', () => {\n  render(<App name={'a' as string} />)\n  expect(screen.getByText('a')).toBeVisible()\n})\n", 'src/App.test.tsx')).toEqual([
      ['renders', ["expect(screen.getByText('a')).toBeVisible()"]],
    ])
  })

  it("gives nothing for a file it can't parse", () => {
    expect(asserted('src/a.test.ts', "it('adds', () => {\n  expect(a).toBe(\n})\n")).toBeUndefined()
  })
})

describe('compareAssertions', () => {
  const both = test('  expect(sum(1, 2)).toBe(3)\n  expect(sum(1, 0)).toBe(1)')

  it.each([
    ['the same assertions indented otherwise, with a comment between them', both, test('      expect(sum(1, 2)).toBe(3)\n\n  // The second.\n\texpect(sum(1,\n    0)).toBe(1)')],
    ['an assertion added', both, test('  expect(sum(1, 2)).toBe(3)\n  expect(sum(1, 0)).toBe(1)\n  expect(sum(0, 0)).toBe(0)')],
    ['the assertions in another order', both, test('  expect(sum(1, 0)).toBe(1)\n  expect(sum(1, 2)).toBe(3)')],
    ['a test added', both, `${both}it('subtracts', () => {})\n`],
    ['what the test does between its assertions changed', both, test('  const three = sum(1, 2)\n  expect(sum(1, 2)).toBe(3)\n  expect(sum(1, 0)).toBe(1)')],
    // The lists of the tests that ran show these.
    ['a test renamed, with fewer assertions', both, "it('sums', () => {\n  expect(sum(1, 2)).toBe(3)\n})\n"],
    ['a test removed', `${both}it('subtracts', () => {\n  expect(a).toBe(1)\n})\n`, both],
    ['a file added', undefined, both],
    ['a file removed', both, undefined],
  ])('finds nothing in %s', (_name, base, head) => {
    expect(said(base, head)).toEqual([])
  })

  it.each([
    ['an assertion removed', test('  expect(sum(1, 2)).toBe(3)'), 'review src/a.test.ts:1: 1 of 2 assertions in `adds` rewritten or removed, the first: `expect(sum(1, 0)).toBe(1)`'],
    ['an assertion that expects another value', test('  expect(sum(1, 2)).toBe(3)\n  expect(sum(1, 0)).toBe(2)'), 'review src/a.test.ts:1: 1 of 2 assertions in `adds` rewritten or removed, the first: `expect(sum(1, 0)).toBe(1)`'],
    ['an assertion turned around', test('  expect(sum(1, 2)).not.toBe(3)\n  expect(sum(1, 0)).toBe(1)'), 'review src/a.test.ts:1: 1 of 2 assertions in `adds` rewritten or removed, the first: `expect(sum(1, 2)).toBe(3)`'],
    ['both assertions rewritten', test('  expect(sum(1, 2)).toBeTruthy()\n  expect(sum(1, 0)).toBeTruthy()'), 'review src/a.test.ts:1: 2 of 2 assertions in `adds` rewritten or removed, the first: `expect(sum(1, 2)).toBe(3)`'],
    ['every assertion removed', test(''), 'review src/a.test.ts:1: 2 of 2 assertions in `adds` rewritten or removed, the first: `expect(sum(1, 2)).toBe(3)`'],
  ])('sends %s to a second review', (_name, head, finding) => {
    expect(said(both, head)).toEqual([finding])
  })

  it('counts an assertion written twice as two, so one of them removed is seen', () => {
    expect(said(test('  expect(a).toBe(1)\n  expect(a).toBe(1)'), test('  expect(a).toBe(1)'))).toEqual(['review src/a.test.ts:1: 1 of 2 assertions in `adds` rewritten or removed, the first: `expect(a).toBe(1)`'])
  })

  it('marks the test that lost an assertion at its line in the branch’s file, and not the test that gained it', () => {
    const base = "it('adds', () => {\n  expect(a).toBe(1)\n})\nit('subtracts', () => {\n  expect(b).toBe(2)\n})\n"
    const head = "// Moved.\nit('adds', () => {\n  expect(a).toBe(1)\n  expect(b).toBe(2)\n})\n\nit('subtracts', () => {})\n"
    expect(said(base, head)).toEqual(['review src/a.test.ts:7: 1 of 1 assertions in `subtracts` rewritten or removed, the first: `expect(b).toBe(2)`'])
  })

  it.each([
    ['rewritten', "const ROWS = [[1, 2], ['two', 5]]\n"],
    ['removed', 'const ROWS = [[1, 2]]\n'],
  ])('sends a row of a test’s table %s to a second review', (_name, rows) => {
    const table = (list: string) => `${list}it.each(ROWS)('adds %s', (a, b) => {\n  expect(sum(a)).toBe(b)\n})\n`
    expect(said(table("const ROWS = [[1, 2], ['two', 4]]\n"), table(rows))).toEqual(["review src/a.test.ts:2: 1 of 3 assertions in `adds %s` rewritten or removed, the first: `row ['two', 4]`"])
  })

  it.each([
    ['one of them', '  expect(b).toBe(2)\n', 'review src/a.test.ts:7: 1 of 2 assertions outside the tests rewritten or removed, the first: `expect(a).toBe(1)`'],
    ['the last of them', '', 'review src/a.test.ts: 2 of 2 assertions outside the tests rewritten or removed, the first: `expect(a).toBe(1)`'],
  ])('sends an assertion removed from a helper or a hook to a second review, as one outside the tests: %s', (_name, helper, finding) => {
    const file = (body: string) => `${both}\nfunction check() {\n${body}}\n`
    expect(said(file('  expect(a).toBe(1)\n  expect(b).toBe(2)\n'), file(helper))).toEqual([finding])
  })

  it('cuts a long name and a long assertion', () => {
    const long = 'a'.repeat(120)
    const [found] = said(`it('${long}', () => {\n  expect(${long}).toBe(1)\n})\n`, `it('${long}', () => {})\n`)
    expect(found).toBe(`review src/a.test.ts:1: 1 of 1 assertions in \`${'a'.repeat(97)}…\` rewritten or removed, the first: \`expect(${'a'.repeat(90)}…\``)
    // One of a hundred characters is given whole.
    const name = 'b'.repeat(100)
    expect(said(`it('${name}', () => {\n  expect(a).toBe(1)\n})\n`, `it('${name}', () => {})\n`)[0]).toContain(`in \`${name}\` rewritten`)
  })

  it.each([
    ["the branch's copy", both, test('  expect(a).toBe('), "review src/a.test.ts: the guard can't parse the file, so what its tests assert isn't compared"],
    ["main's copy", test('  expect(a).toBe('), both, "review src/a.test.ts: the guard can't parse main's copy of the file, so what its tests assert isn't compared"],
    ['either copy', test('  expect(a).toBe('), test('  expect(a).toBe('), "review src/a.test.ts: the guard can't parse the file, so what its tests assert isn't compared"],
  ])("says so when it can't parse %s", (_name, base, head, finding) => {
    expect(said(base, head)).toEqual([finding])
  })
})
