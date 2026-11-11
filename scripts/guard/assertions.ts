// The checks guard's reading of a test file: its tests and what each one asserts, so that an
// assertion rewritten or removed inside a test that stays is marked for a second review
// (docs/QUALITY.md → The checks guard). The file is parsed, not run: the tests themselves are
// counted from the run (tests.ts).
import { parseSync } from 'vite'
import type { Finding } from './signs.ts'

type Node = { type: string; start: number; end: number; [key: string]: unknown }

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
const childrenOf = (node: Node): Node[] => Object.values(node).flatMap((value) => (Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : []))
const isFunction = (node: Node | undefined): boolean => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'

/** The names a chain of calls and members is made of, from its start: `it`, `each` for `it.each(ROWS)('…', …)`. */
function chain(node: Node): string[] {
  if (node.type === 'Identifier') return [node.name as string]
  if (node.type === 'CallExpression') return chain(node.callee as Node)
  if (node.type === 'TaggedTemplateExpression') return chain(node.tag as Node)
  if (node.type === 'MemberExpression') return [...chain(node.object as Node), ...chain(node.property as Node)]
  return []
}

/** An assertion by its name: `expect` and what is built on it (`expectTypeOf`, a helper named `expectRow`), and `assert`. */
const ASSERTS = /^(?:expect|assert)/
/** What groups tests, as against a test: `describe`, `suite`, Playwright's `test.describe`. */
const GROUPS = ['describe', 'suite']
const TESTS = ['it', 'test']
/** Calls on `test` that take a title and a function and aren't tests: a step is a part of its test. */
const NOT_A_TEST = ['step']
const TABLES = ['each', 'for']

/** What a file's tests assert, by the test's name with its groups'; '' holds what is asserted outside any test (a helper, a hook). */
export type Asserted = Map<string, { line: number; items: string[] }>

/**
 * The tests of a file and what each asserts: every call that starts from `expect` or `assert`, as
 * written, and every row of the table an `each` runs it over, since a row holds what is expected.
 * Undefined when the file can't be parsed.
 */
export function asserted(path: string, text: string): Asserted | undefined {
  const { program, errors } = parseSync(path, text)
  if (errors.length > 0) return undefined
  const file = program as unknown as Node
  const source = (node: Node): string => text.slice(node.start, node.end).replace(/\s+/g, ' ')
  const lineOf = (node: Node): number => text.slice(0, node.start).split('\n').length
  const found: Asserted = new Map()
  const into = (name: string, node: Node, items: string[]) => {
    const test = found.get(name) ?? { line: lineOf(node), items: [] }
    found.set(name, { line: test.line, items: [...test.items, ...items] })
  }
  // `[…] as const`, `[…] satisfies Row[]`.
  const bare = (node: Node): Node => ((node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') && isNode(node.expression) ? bare(node.expression) : node)
  /** The lists the file declares by a name, for a table that is given by one. */
  const lists = new Map<string, Node>()
  const declare = (node: Node) => {
    if (node.type === 'VariableDeclarator' && isNode(node.id) && node.id.type === 'Identifier' && isNode(node.init)) lists.set(node.id.name as string, bare(node.init))
    childrenOf(node).forEach(declare)
  }
  declare(file)
  /** The rows of a table given in place or by the name of a list; a table the guard can't open (imported, computed) is one item, as written. */
  const rows = (table: Node): string[] => {
    const list = table.type === 'Identifier' ? (lists.get(table.name as string) ?? table) : bare(table)
    return list.type === 'ArrayExpression' ? (list.elements as unknown[]).filter(isNode).map((row) => `row ${source(row)}`) : [`table ${source(table)}`]
  }

  const walk = (node: Node, groups: string[], test: string) => {
    if (node.type === 'CallExpression') {
      const names = chain(node)
      const [first, ...args] = node.arguments as Node[]
      const last = args.at(-1)
      if (ASSERTS.test(names[0] ?? '')) {
        into(test, node, [source(node)])
        return
      }
      const titled = first && !isFunction(first) && isFunction(last)
      const group = GROUPS.includes(names[0]) || (TESTS.includes(names[0]) && names.includes('describe'))
      if (titled && (group || (TESTS.includes(names[0]) && !names.some((name) => NOT_A_TEST.includes(name))))) {
        const title = first.type === 'Literal' && typeof first.value === 'string' ? first.value : source(first)
        const name = [...groups, title].join(' › ')
        const callee = node.callee as Node
        const given = callee.type === 'CallExpression' && TABLES.includes(names.at(-1) ?? '') ? (callee.arguments as Node[])[0] : undefined
        const table = given ? rows(given) : []
        if (group) {
          if (table.length > 0) into(name, node, table)
          walk(last as Node, [...groups, title], test)
        } else {
          into(name, node, table)
          walk(last as Node, groups, name)
        }
        return
      }
    }
    for (const child of childrenOf(node)) walk(child, groups, test)
  }
  walk(file, [], '')
  return found
}

const brief = (text: string): string => (text.length > 100 ? `${text.slice(0, 97)}…` : text)

/**
 * A test file the branch changes: each test that both sides have by its name, and what is asserted
 * outside the tests, with the assertions and table rows main's copy has and the branch's doesn't. A
 * test that is gone or renamed isn't looked at here: the lists of the tests that ran show it.
 */
export function compareAssertions(file: string, base: string | undefined, head: string | undefined): Finding[] {
  if (base === undefined || head === undefined) return []
  const [was, now] = [asserted(file, base), asserted(file, head)]
  if (!now) return [{ needs: 'review', file, what: "the guard can't parse the file, so what its tests assert isn't compared" }]
  if (!was) return [{ needs: 'review', file, what: "the guard can't parse main's copy of the file, so what its tests assert isn't compared" }]
  return [...was].flatMap(([name, { items }]): Finding[] => {
    // What is asserted outside the tests is compared even when the branch has none of it left.
    const test = now.get(name) ?? (name === '' ? { line: undefined, items: [] } : undefined)
    if (!test) return []
    const left = [...test.items]
    const gone = items.filter((item) => {
      const index = left.indexOf(item)
      if (index === -1) return true
      left.splice(index, 1)
      return false
    })
    if (gone.length === 0) return []
    const where = name === '' ? 'outside the tests' : `in \`${brief(name)}\``
    return [{ needs: 'review', file, line: test.line, what: `${gone.length} of ${items.length} assertions ${where} rewritten or removed, the first: \`${brief(gone[0])}\`` }]
  })
}
