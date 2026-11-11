// The checks guard's count of tests: the tests a run reported on main's side and on the branch's,
// so that a test that is gone, renamed or no longer runs is marked (docs/QUALITY.md → The checks
// guard). The lists come from the runs themselves, where a table's every row is a test of its own
// and a skipped test is seen as one: Vitest's JSON reporter and Playwright's `--list`.
import type { Finding } from './signs.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
const isObject = (value: Json | undefined): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value)
const listOf = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : [])

/** A test that ran, or would in Playwright's list: the file it is in and its name with its groups'. */
export type Test = { file: string; name: string }

const NAME = ' › '

/** Vitest's report: a test counts when it ran, so not one that is skipped or still to be written. */
function vitestTests(report: { [key: string]: Json }): Test[] {
  return listOf(report.testResults).flatMap((file) =>
    isObject(file)
      ? listOf(file.assertionResults)
          .filter(isObject)
          .filter(({ status }) => status === 'passed' || status === 'failed')
          .map(({ ancestorTitles, title }) => ({ file: `${file.name}`, name: [...listOf(ancestorTitles), title].join(NAME) }))
      : [],
  )
}

/** Playwright's list: a test counts once per project it would run in, and not when it is skipped. */
function playwrightTests(report: { [key: string]: Json }): Test[] {
  const folder = isObject(report.config) ? report.config.rootDir : ''
  const within = (suite: Json, groups: Json[]): Test[] => {
    if (!isObject(suite)) return []
    const specs = listOf(suite.specs)
      .filter(isObject)
      .flatMap((spec) =>
        listOf(spec.tests)
          .filter((test) => isObject(test) && test.expectedStatus !== 'skipped')
          .map(() => ({ file: [folder, spec.file].filter(Boolean).join('/'), name: [...groups, spec.title].join(NAME) })),
      )
    return [...specs, ...listOf(suite.suites).flatMap((inner) => within(inner, isObject(inner) ? [...groups, inner.title] : groups))]
  }
  // The outermost suites are the files, whose titles are their paths.
  return listOf(report.suites).flatMap((file) => within(file, []))
}

/** The tests in one report, Vitest's or Playwright's; none when it is neither or can't be read. */
export function testsIn(report: string): Test[] {
  let json: Json | undefined
  try {
    json = JSON.parse(report)
  } catch {
    // Not JSON: no tests, as for any report that isn't one.
  }
  if (!isObject(json)) return []
  return 'testResults' in json ? vitestTests(json) : playwrightTests(json)
}

/** The tests of one side's run, report by report: the report's name (`vitest.json`) and the tests in it, none when it couldn't be read. */
export type Reports = Map<string, Test[]>

/** At most this many names of a file's tests in one finding, so a file removed doesn't fill the PR's comment. */
const NAMED = 10

/**
 * The tests main's run has and the branch's doesn't, file by file. They go to the owner where the
 * branch runs fewer tests, in that file and in all: a test removed with nothing in its place. Else
 * to a second review, which tells a test renamed or moved from one replaced by a weaker one.
 *
 * Only the reports that gave tests on both sides are compared. One that a side lacks, or that gave
 * no tests there, is a part of the run the guard can't see, said once: the branch's for the owner,
 * main's for a second review. Otherwise main's missing unit tests would let every test the branch
 * removed pass unseen behind the browser tests both sides list.
 */
export function compareTests(reported: Reports, ran: Reports): Finding[] {
  const names = [...new Set([...reported.keys(), ...ran.keys()])]
  if (names.length === 0) return [{ needs: 'owner', what: "the runs gave no lists of their tests, so the guard can't see a test that is gone" }]
  const both = names.filter((name) => reported.get(name)?.length && ran.get(name)?.length)
  const unseen = names
    .filter((name) => !both.includes(name))
    .map((name): Finding => {
      const side = ran.get(name)?.length ? { needs: 'review' as const, whose: "main's" } : { needs: 'owner' as const, whose: "the branch's" }
      return { needs: side.needs, what: `${side.whose} run gave no tests in \`${name}\`, so the guard can't see a test of it that is gone` }
    })
  const [base, head] = [reported, ran].map((side) => both.flatMap((name) => side.get(name) ?? []))
  const byFile = (tests: Test[]): Map<string, string[]> => {
    const files = new Map<string, string[]>()
    for (const { file, name } of tests) files.set(file, [...(files.get(file) ?? []), name])
    return files
  }
  const now = byFile(head)
  const gone = [...byFile(base)].flatMap(([file, names]): Finding[] => {
    const left = [...(now.get(file) ?? [])]
    const kept = left.length
    const gone = names.filter((name) => {
      const index = left.indexOf(name)
      if (index === -1) return true
      left.splice(index, 1)
      return false
    })
    if (gone.length === 0) return []
    const named = gone.slice(0, NAMED).map((name) => `\`${name}\``)
    const which = `${named.join(', ')}${gone.length > NAMED ? ` and ${gone.length - NAMED} more` : ''}`
    return kept < names.length && head.length < base.length
      ? [{ needs: 'owner', file, what: `fewer tests run: ${names.length} → ${kept} here, ${base.length} → ${head.length} in all. Gone or no longer run: ${which}` }]
      : [{ needs: 'review', file, what: `${gone.length} of ${names.length} tests main runs here are gone, renamed or no longer run: ${which}` }]
  })
  return [...unseen, ...gone]
}
