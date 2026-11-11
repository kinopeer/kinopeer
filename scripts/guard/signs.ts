// The checks guard's signs: what in a branch's changes weakens the checks or changes existing ones.
// Pure rules over the text of the changed files, read by guard.ts, which CI runs from main's copy
// (docs/TESTING.md → The checks guard). The guard marks too much rather than too little: what it
// can't read or can't judge is marked, not passed.

/**
 * What a finding calls for before the PR merges: the owner's approval with a reason (a weakening, or
 * a change to the guard itself), or a second, independent review of the lines marked (a change to an
 * existing check that a script can't judge).
 */
export type Needs = 'owner' | 'review'

export type Finding = { needs: Needs; file: string; line?: number; what: string }

/** A line the branch adds, with its number in the branch's version of the file. */
export type AddedLine = { line: number; text: string }

/**
 * A file the branch changes. `base` and `head` are its text on main's side and on the branch's,
 * undefined where it doesn't exist; guard.ts loads them only for the files `readsWhole` names.
 */
export type Change = { path: string; base?: string; head?: string; added: AddedLine[] }

export const CHECKS_FILE = 'checks.json'
export const LINT_FILE = '.oxlintrc.json'
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/
/** The guard itself: a change to it goes to the owner, whatever it is. */
const GUARD = /^scripts\/guard\/|^\.github\/workflows\/guard\.yml$/
/** The tests and what runs them, where a retry is a test's retry rather than the app's own. */
const RUNS_TESTS = /\.test\.tsx?$|^e2e\/|^(?:vite|playwright[^/]*)\.config\.ts$|^stryker\.config\.mjs$|^package\.json$|^\.github\/workflows\/|^scripts\//
const SCREENSHOTS = /^e2e\/|^playwright[^/]*\.config\.ts$/

/** Whether the guard compares the file's two versions whole, rather than only the lines added. */
export const readsWhole = (path: string): boolean => path === CHECKS_FILE || path === LINT_FILE || WORKFLOW.test(path)

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const isObject = (value: Json | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: Json | undefined, b: Json | undefined): boolean => JSON.stringify(a) === JSON.stringify(b)
const show = (value: Json | undefined): string => (value === undefined ? 'nothing' : `\`${JSON.stringify(value)}\``)

/**
 * Both versions of a JSON file parsed, or the finding that says which one couldn't be: the branch's
 * goes to the owner, since a check that reads it is broken or off; main's leaves nothing to compare
 * the branch's with, which a second review looks at.
 */
function parseBoth(file: string, base: string, head: string): { base: JsonObject; head: JsonObject } | Finding {
  const parse = (text: string): JsonObject | undefined => {
    try {
      const value = JSON.parse(text) as Json
      return isObject(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  const [was, now] = [parse(base), parse(head)]
  if (!now) return { needs: 'owner', file, what: "the guard can't read the file as a JSON object, so it can't compare it" }
  if (!was) return { needs: 'review', file, what: "the guard can't read main's copy as a JSON object, so it has nothing to compare this one with" }
  return { base: was, head: now }
}

/** Each leaf of a JSON object by its dotted path; a list is a leaf. */
function leaves(value: Json, path = ''): Map<string, Json> {
  if (!isObject(value)) return new Map([[path, value]])
  return new Map(Object.entries(value).flatMap(([key, child]) => [...leaves(child, path ? `${path}.${key}` : key)]))
}

/** The lists in checks.json where a new entry leaves more out of a check, and those where a lost one does. */
const EXCLUDES = ['coverage.exclude', 'mutants.excludedMutations', 'mutants.notProduction']
const INCLUDES = ['coverage.include', 'mutants.folders']
const THRESHOLD = 'coverage.thresholds.'

const entries = (value: Json | undefined): string[] => (Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)) : [])

/**
 * checks.json, the thresholds and the exclusion lists: a threshold that went down, an exclusion list
 * that grew or a list of what is checked that shrank is a weakening; any other change to the file is a
 * change to existing checks.
 */
export function compareChecks(base: string | undefined, head: string | undefined, file = CHECKS_FILE): Finding[] {
  if (head === undefined) return [{ needs: 'owner', file, what: 'the file with the thresholds and the exclusion lists is removed' }]
  // A file main doesn't have yet has nothing to weaken.
  if (base === undefined) return []
  const parsed = parseBoth(file, base, head)
  if ('needs' in parsed) return [parsed]
  const [was, now] = [leaves(parsed.base), leaves(parsed.head)]
  const found: Finding[] = []
  const owner = (what: string) => found.push({ needs: 'owner', file, what })
  const review = (what: string) => found.push({ needs: 'review', file, what })
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const [before, after] = [was.get(key), now.get(key)]
    if (same(before, after)) continue
    if (key.startsWith(THRESHOLD)) {
      const lowered = typeof before === 'number' && !(typeof after === 'number' && after >= before)
      if (lowered) owner(`the threshold \`${key}\` is lowered: ${show(before)} → ${show(after)}`)
      else review(`the threshold \`${key}\` changed: ${show(before)} → ${show(after)}`)
    } else if (EXCLUDES.includes(key) || INCLUDES.includes(key)) {
      const [had, has] = [entries(before), entries(after)]
      const added = has.filter((entry) => !had.includes(entry))
      const removed = had.filter((entry) => !has.includes(entry))
      const excludes = EXCLUDES.includes(key)
      for (const entry of excludes ? added : removed) owner(`\`${key}\` ${excludes ? 'leaves out more' : 'takes in less'}: \`${entry}\` is ${excludes ? 'added' : 'removed'}`)
      for (const entry of excludes ? removed : added) review(`\`${key}\` changed: \`${entry}\` is ${excludes ? 'removed' : 'added'}`)
    } else {
      review(`\`${key}\` changed: ${show(before)} → ${show(after)}`)
    }
  }
  return found
}

/** A lint rule's severity as a rank, 0 for off; undefined for a value the guard doesn't know. */
function rank(rule: Json | undefined): number | undefined {
  const severity = Array.isArray(rule) ? rule[0] : rule
  if (severity === 'off' || severity === 'allow' || severity === 0) return 0
  if (severity === 'warn' || severity === 1) return 1
  if (severity === 'error' || severity === 'deny' || severity === 2) return 2
  return undefined
}

/**
 * One block of lint rules against main's: a rule removed, turned off or downgraded is a weakening. A
 * rule the block didn't name before is compared with `fallback`, the top-level rules for an override;
 * with none, turning it off is a weakening (it may have been on by default) and `warn` can't be judged.
 */
function compareRules(file: string, where: string, base: JsonObject, head: JsonObject, fallback: JsonObject = {}): Finding[] {
  const found: Finding[] = []
  for (const name of new Set([...Object.keys(base), ...Object.keys(head)])) {
    const [before, after] = [base[name] ?? fallback[name], head[name]]
    if (same(before, after)) continue
    const rule = `the lint rule \`${name}\`${where}`
    const [was, now] = [rank(before), rank(after)]
    if (after === undefined) {
      if (was !== 0) found.push({ needs: 'owner', file, what: `${rule} is removed` })
    } else if (now === undefined) {
      found.push({ needs: 'owner', file, what: `${rule} has a severity the guard can't read: ${show(after)}` })
    } else if (before === undefined) {
      if (now === 0) found.push({ needs: 'owner', file, what: `${rule} is turned off` })
      else if (now === 1) found.push({ needs: 'review', file, what: `${rule} is added as \`warn\`, which doesn't fail the run` })
    } else if (was === undefined || now < was) {
      found.push({ needs: 'owner', file, what: `${rule} is ${now === 0 ? 'turned off' : 'downgraded'}: ${show(before)} → ${show(after)}` })
    } else if (now === was) {
      found.push({ needs: 'review', file, what: `${rule} has other options: ${show(before)} → ${show(after)}` })
    }
    // What is left is a rule made stricter: nothing to mark.
  }
  return found
}

const rulesOf = (config: JsonObject): JsonObject => (isObject(config.rules) ? config.rules : {})
const overridesOf = (config: JsonObject): JsonObject[] => (Array.isArray(config.overrides) ? config.overrides.filter(isObject) : [])
const filesOf = (override: JsonObject): string => JSON.stringify(override.files)

/**
 * The linter's config: a rule removed, turned off or downgraded, a plugin removed or a path added to
 * what the linter skips is a weakening; other changes to it are changes to existing checks.
 */
export function compareLint(base: string | undefined, head: string | undefined, file = LINT_FILE): Finding[] {
  if (head === undefined) return [{ needs: 'owner', file, what: "the linter's config is removed" }]
  if (base === undefined) return []
  const parsed = parseBoth(file, base, head)
  if ('needs' in parsed) return [parsed]
  const { base: was, head: now } = parsed
  const found = compareRules(file, '', rulesOf(was), rulesOf(now))
  for (const plugin of entries(was.plugins)) {
    if (!entries(now.plugins).includes(plugin)) found.push({ needs: 'owner', file, what: `the lint plugin ${plugin} is removed, and its rules with it` })
  }
  for (const pattern of entries(now.ignorePatterns)) {
    if (!entries(was.ignorePatterns).includes(pattern)) found.push({ needs: 'owner', file, what: `the linter skips more: ${pattern} is added to \`ignorePatterns\`` })
  }
  const before = new Map(overridesOf(was).map((override) => [filesOf(override), override]))
  const after = new Map(overridesOf(now).map((override) => [filesOf(override), override]))
  for (const files of new Set([...before.keys(), ...after.keys()])) {
    const where = ` for ${files}`
    found.push(...compareRules(file, where, rulesOf(before.get(files) ?? {}), rulesOf(after.get(files) ?? {}), after.has(files) ? rulesOf(was) : {}))
  }
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (['rules', 'plugins', 'ignorePatterns', 'overrides', '$schema'].includes(key) || same(was[key], now[key])) continue
    found.push({ needs: 'review', file, what: `\`${key}\` changed: ${show(was[key])} → ${show(now[key])}` })
  }
  return found
}

/**
 * A workflow's steps, each as what it runs: an action without its version (so a bump isn't a change)
 * or a command. Read line by line rather than as YAML, which Node can't parse without a dependency:
 * a `run:` or `uses:` key and, for a block scalar, the lines indented under it.
 */
export function workflowSteps(text: string): string[] {
  const lines = text.split('\n')
  const steps: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const key = /^(\s*(?:- )?)(uses|run):\s*(.*)$/.exec(lines[index])
    if (!key) continue
    const [, lead, name, value] = key
    if (name === 'uses') {
      steps.push(`uses: ${value.replace(/\s+#.*$/, '').replace(/@[^@]*$/, '')}`)
    } else if (/^[|>][+-]?\s*$/.test(value)) {
      const block: string[] = []
      while (index + 1 < lines.length && (lines[index + 1].trim() === '' || lines[index + 1].search(/\S/) > lead.length)) {
        const line = lines[++index].trim()
        if (line && !line.startsWith('#')) block.push(line)
      }
      steps.push(`run: ${block.join(' ; ')}`)
    } else {
      steps.push(`run: ${value}`)
    }
  }
  return steps
}

const brief = (step: string): string => (step.length > 120 ? `${step.slice(0, 117)}…` : step)

/**
 * A CI workflow: a step that is gone is a weakening when the workflow has fewer steps than before,
 * and a change to an existing check when another took its place (a command edited).
 */
export function compareWorkflow(file: string, base: string | undefined, head: string | undefined): Finding[] {
  if (base === undefined) return []
  if (head === undefined) return [{ needs: 'owner', file, what: 'the workflow is removed, and its steps with it' }]
  const [was, now] = [workflowSteps(base), workflowSteps(head)]
  const left = [...now]
  const gone = was.filter((step) => {
    const index = left.indexOf(step)
    if (index === -1) return true
    left.splice(index, 1)
    return false
  })
  const fewer = now.length < was.length
  return gone.map((step) => ({
    needs: fewer ? ('owner' as const) : ('review' as const),
    file,
    what: `${fewer ? 'a CI step is removed' : 'a CI step changed, it was'}: \`${brief(step)}\``,
  }))
}

/** What a line the branch adds can bring in, where it counts, and what the finding says. */
const ADDED: { pattern: RegExp; files: RegExp; what: string }[] = [
  // `retry: 2`, `retries: process.env.CI ? 2 : 0`, `--retries=2`; not `retries: 0`.
  { pattern: /\bretr(?:y|ies)\b["']?\s*[:=](?!\s*0\b)|--retr(?:y|ies)\b/, files: RUNS_TESTS, what: 'test retries appeared' },
  { pattern: /\bmaxDiffPixels\b|\bmaxDiffPixelRatio\b|\bthreshold\b["']?\s*:/, files: SCREENSHOTS, what: 'a screenshot tolerance appeared' },
]

/** The lines a branch adds to one file, against the patterns above. */
export function scanAdded(file: string, added: AddedLine[]): Finding[] {
  return ADDED.filter(({ files }) => files.test(file)).flatMap(({ pattern, what }) =>
    added.filter(({ text }) => pattern.test(text)).map(({ line, text }) => ({ needs: 'owner' as const, file, line, what: `${what}: \`${brief(text.trim())}\`` })),
  )
}

/** Every finding in a branch's changes. */
export function findings(changes: Change[]): Finding[] {
  return changes.flatMap(({ path, base, head, added }) => {
    // The guard's own files hold these patterns as text, and each change to them goes to the owner anyway.
    if (GUARD.test(path)) return [{ needs: 'owner' as const, file: path, what: 'the checks guard itself changed' }]
    if (path === CHECKS_FILE) return compareChecks(base, head)
    if (path === LINT_FILE) return compareLint(base, head)
    return [...(WORKFLOW.test(path) ? compareWorkflow(path, base, head) : []), ...scanAdded(path, added)]
  })
}

/** The marker the workflow finds the guard's comment on a PR by. */
export const MARKER = '<!-- checks-guard -->'

const list = (found: Finding[]): string[] => found.map(({ file, line, what }) => `- \`${file}${line ? `:${line}` : ''}\`: ${what}`)

/** The guard's report, as Markdown: the comment on the PR, the job's summary and what `npm run guard` prints. */
export function report(found: Finding[], { head, base }: { head: string; base: string }): string {
  const owner = found.filter(({ needs }) => needs === 'owner')
  const review = found.filter(({ needs }) => needs === 'review')
  const lines = [MARKER, `**Checks guard at ${head}**, against \`main\` at ${base}.`]
  if (found.length === 0) lines.push('', 'No weakening of the checks and no change to existing ones.')
  if (owner.length > 0) lines.push('', `**For the owner: ${owner.length} to approve, each with a reason.** A weakening of the checks, or a change to the guard itself.`, '', ...list(owner))
  if (review.length > 0) lines.push('', `**For a second review: ${review.length}.** Changes to existing checks, which a script can't judge.`, '', ...list(review))
  return lines.join('\n')
}
