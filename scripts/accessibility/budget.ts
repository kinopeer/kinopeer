// The accessibility budget's rules: the budgets read from checks.json, the state a screenshot names
// and the verdict on what axe found there. Pure, with no Node or browser APIs: the screenshot tests
// run axe (e2e/test.ts) and hand its violations here (docs/QUALITY.md → The accessibility budget).

/**
 * What axe checks and how many elements may break each rule, from checks.json: `tags`, the WCAG levels
 * axe reads (`budgets.accessibilityTags`), and `states`, by spec, then screenshot, then axe's rule,
 * the count of elements that break it there (`budgets.accessibility`).
 */
export type Budgets = { tags: string[]; states: Record<string, Record<string, Record<string, number>>> }

/** A state the screenshot tests read: the spec (`downloads` for e2e/downloads.spec.ts) and the screenshot's name without `.png`. */
export type State = { spec: string; shot: string }

/** One rule axe found broken: its id, what it asks and where it explains it, and the elements that break it. */
export type Violation = { id: string; help: string; helpUrl: string; nodes: { target: string; html: string }[] }

/** What the check found: whether it passes, and what to say when it doesn't. */
export type Verdict = { passed: boolean; report: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const where = (...path: string[]) => `\`budgets.accessibility${path.map((key) => `[${JSON.stringify(key)}]`).join('')}\``
const TAGS = '`budgets.accessibilityTags`'

/**
 * A key the checks guard can read: it joins a budget's keys with dots, so a key with a dot in it would
 * land on another budget's path and hide a raise of it (docs/QUALITY.md → What it doesn't see).
 */
const readable = (key: string) => key !== '' && !key.includes('.')

/**
 * The tags axe checks, or what is wrong with them: a list of one tag or more, each a string that isn't
 * empty. Whether axe knows each is for the read to check, with the axe it runs (`unknownTags`).
 */
function readTags(tags: unknown): string[] | string {
  if (tags === undefined) return `${TAGS} in checks.json is missing`
  const fine = Array.isArray(tags) && tags.length > 0 && tags.every((tag) => typeof tag === 'string' && tag !== '')
  return fine ? (tags as string[]) : `${TAGS} is not a list of axe's tags: \`${JSON.stringify(tags)}\``
}

/**
 * The budgets in checks.json's object, or what is wrong with them: the tags (`readTags`), and an object
 * of specs, each an object of screenshots, each an object of axe's rules, each a whole number of
 * elements, 0 or more. No key may have a dot in it (`readable`). More is weaker.
 */
export function readBudgets(checks: unknown): Budgets | string[] {
  const all = isObject(checks) && isObject(checks.budgets) ? checks.budgets : undefined
  const tags = readTags(all?.accessibilityTags)
  const problems: string[] = typeof tags === 'string' ? [tags] : []
  const states = all?.accessibility
  if (!isObject(states)) return [...problems, `${where()} in checks.json is ${states === undefined ? 'missing' : 'not an object of specs'}`]
  const unreadable = (key: string, ...path: string[]) => {
    if (!readable(key)) problems.push(`${where(...path)} has a key the checks guard can't read, empty or with a dot in it`)
  }
  for (const [spec, shots] of Object.entries(states)) {
    unreadable(spec, spec)
    if (!isObject(shots)) {
      problems.push(`${where(spec)} is not an object of screenshots`)
      continue
    }
    for (const [shot, rules] of Object.entries(shots)) {
      unreadable(shot, spec, shot)
      if (!isObject(rules)) {
        problems.push(`${where(spec, shot)} is not an object of axe's rules`)
        continue
      }
      for (const [rule, budget] of Object.entries(rules)) {
        unreadable(rule, spec, shot, rule)
        if (!(Number.isSafeInteger(budget) && (budget as number) >= 0)) {
          problems.push(`${where(spec, shot, rule)} is not a whole number of elements, 0 or more: \`${JSON.stringify(budget)}\``)
        }
      }
    }
  }
  return problems.length > 0 ? problems : { tags: tags as string[], states: states as Budgets['states'] }
}

/**
 * The tags none of axe's rules has (`known`, every rule's tags), named, or undefined when axe knows them
 * all: axe skips a tag it doesn't know without a word, so a misspelled one would leave its rules unread.
 */
export function unknownTags(tags: string[], known: string[]): string | undefined {
  const unknown = tags.filter((tag) => !known.includes(tag))
  if (unknown.length === 0) return undefined
  return `${TAGS} names ${unknown.map((tag) => `\`${tag}\``).join(', ')}, which no rule of axe's has: axe would read nothing for it`
}

/**
 * The state a screenshot shows, or what is wrong with its name: the spec's file without `.spec.ts`
 * and the screenshot's name without `.png`. Every screenshot is named, and its name has no other dot,
 * so the state is a key the checks guard can read.
 */
export function stateOf(file: string, name: unknown): State | string {
  const base = file.split(/[\\/]/).at(-1)!
  const spec = base.replace(/\.spec\.ts$/, '')
  if (typeof name !== 'string') return `A screenshot in ${base} has no name: name it, so its accessibility budget has a key`
  const shot = name.replace(/\.png$/, '')
  if (!name.endsWith('.png') || !readable(shot) || !readable(spec)) {
    return `The screenshot ${name} in ${base} needs a name ending in .png with no other dot, in a spec whose name has none but its .spec.ts, so its accessibility budget has a key the checks guard can read`
  }
  return { spec, shot }
}

/** The elements that break each rule, by the rule's id. */
export const counts = (violations: Violation[]): Record<string, number> => Object.fromEntries(violations.map(({ id, nodes }) => [id, nodes.length]))

/** How many elements a failure lists of a rule before it says how many more there are. */
export const LISTED = 10

/** A rule's elements as a failure lists them: its selector and the start of its HTML. */
function elements(nodes: Violation['nodes']): string[] {
  const shown = nodes.slice(0, LISTED).map(({ target, html }) => `    - ${target}: ${html.length > 120 ? `${html.slice(0, 120)}…` : html}`)
  return nodes.length > LISTED ? [...shown, `    - and ${nodes.length - LISTED} more`] : shown
}

/**
 * A screenshot's state against its budgets: for every rule, axe's count of elements that break it
 * must be its budget, 0 for a rule without one. Reads on mocked data come out the same every run, so
 * a count under its budget fails too: the budget is lowered with the fix, and a budget left higher
 * would let a broken element come back unnoticed.
 */
export function judge({ spec, shot }: State, violations: Violation[], budgets: Budgets): Verdict {
  const found = counts(violations)
  const budget = budgets.states[spec]?.[shot]
  const byRule = new Map(violations.map((violation) => [violation.id, violation]))
  if (budget === undefined) {
    const report = [
      `${where(spec, shot)} is missing for a screenshot the tests take: add it to checks.json as \`${JSON.stringify(found)}\`, what axe finds there.`,
      ...violations.flatMap((violation) => [`- ${violation.id}: ${violation.nodes.length} (${violation.help}, ${violation.helpUrl})`, ...elements(violation.nodes)]),
    ].join('\n')
    return { passed: false, report }
  }
  const rules = [...new Set([...Object.keys(budget), ...Object.keys(found)])].sort()
  const off = rules.filter((rule) => (found[rule] ?? 0) !== (budget[rule] ?? 0))
  if (off.length === 0) return { passed: true, report: '' }
  const lines = off.flatMap((rule) => {
    const [count, allowed] = [found[rule] ?? 0, budget[rule] ?? 0]
    if (count < allowed) return [`- ${rule}: ${count}, under its budget of ${allowed}: lower it to ${count} in checks.json`]
    const violation = byRule.get(rule)!
    return [`- ${rule}: ${count}, over its budget of ${allowed} (${violation.help}, ${violation.helpUrl})`, ...elements(violation.nodes)]
  })
  return { passed: false, report: [`The ${spec} screenshot ${shot} isn't what its accessibility budgets say (${where(spec, shot)}):`, ...lines].join('\n') }
}

/**
 * The budgets for no screenshot the tests take, and the screenshots without a budget: each screenshot
 * that has a baseline (`taken`) has its budgets, `{}` where axe finds nothing.
 */
export function unmatched(budgets: Budgets, taken: State[]): string[] {
  const isTaken = (spec: string, shot: string) => taken.some((one) => one.spec === spec && one.shot === shot)
  const stale = Object.entries(budgets.states).flatMap(([spec, shots]) =>
    Object.keys(shots)
      .filter((shot) => !isTaken(spec, shot))
      .map((shot) => `${where(spec, shot)} is a budget for a screenshot with no baseline: take it out of checks.json`),
  )
  const missing = taken
    .filter(({ spec, shot }) => budgets.states[spec]?.[shot] === undefined)
    .map(({ spec, shot }) => `${where(spec, shot)} is missing for a screenshot with a baseline: add it to checks.json`)
  return [...stale, ...missing]
}
