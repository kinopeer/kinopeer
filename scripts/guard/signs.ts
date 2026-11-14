// The checks guard's signs: what in a branch's changes weakens the checks or changes existing ones.
// Pure rules over the text of the changed files, read by guard.ts, which CI runs from main's copy
// (docs/QUALITY.md → The checks guard, which lists the signs: a new one goes there too). The guard marks too much rather than too little: what it
// can't read or can't judge is marked, not passed. What a test file asserts is read in assertions.ts,
// and the tests that ran are compared in tests.ts.
import { compareAssertions } from './assertions.ts'
import { atRulesIn, rawValues, tokensIn, TOKENS_FILE, type Sheet } from './stylesheets.ts'

/**
 * What a finding calls for before the PR merges: the owner's approval with a reason (a weakening, or
 * a change to the guard itself), the coordinator's approval with a reason (a design value added or
 * changed: a token, or a value off the tokens' scale that a comment lets through), or a second,
 * independent review of the lines marked (a change to an existing check that a script can't judge).
 */
export type Needs = 'owner' | 'coordinator' | 'review'

/** `file` is missing where a finding is about the branch as a whole, such as a run that gave no list of its tests. */
export type Finding = { needs: Needs; file?: string; line?: number; what: string }

/** A line the branch adds, with its number in the branch's version of the file. */
export type AddedLine = { line: number; text: string }

/**
 * A file the branch changes. `base` and `head` are its text on main's side and on the branch's,
 * undefined where it doesn't exist or isn't loaded: guard.ts loads them only for the files `readsWhole` names.
 */
export type Change = { path: string; base?: string; head?: string; added: AddedLine[] }

export const CHECKS_FILE = 'checks.json'
export const LINT_FILE = '.oxlintrc.json'
export const PACKAGE_FILE = 'package.json'
const WORKFLOWS = '.github/workflows/'
const inRoot = (path: string): boolean => !path.includes('/')
const isWorkflow = (path: string): boolean => path.startsWith(WORKFLOWS) && inRoot(path.slice(WORKFLOWS.length)) && (path.endsWith('.yml') || path.endsWith('.yaml'))
/** The guard itself and its rules, the second review's procedure among them: a change to them goes to the owner, whatever it is. */
const isGuard = (path: string): boolean =>
  path.startsWith('scripts/guard/') || path === `${WORKFLOWS}guard.yml` || path === 'docs/QUALITY.md' || path.startsWith('.claude/skills/second-review/')
const isDoc = (path: string): boolean => path.endsWith('.md')
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
/** A lint config outside the root, which oxlint obeys for its folder: the root's rules turned off without touching the root's config. */
const isNestedLintConfig = (path: string): boolean => nameOf(path) === LINT_FILE && !inRoot(path)
/** A file of paths the linter skips. */
const isLintIgnore = (path: string): boolean => ['.eslintignore', '.oxlintignore'].includes(nameOf(path))
/** The type check's settings, in the root or in a folder with a project of its own. */
const isTypeCheckConfig = (path: string): boolean => nameOf(path).startsWith('tsconfig.') && path.endsWith('.json')
const isUnitTest = (path: string): boolean => path.endsWith('.test.ts') || path.endsWith('.test.tsx')
const isTest = (path: string): boolean => isUnitTest(path) || path.startsWith('e2e/')
/** A test file or one of the browser tests' own modules, as against a screenshot beside them: code whose assertions the guard compares. */
const isTestCode = (path: string): boolean => isTest(path) && (path.endsWith('.ts') || path.endsWith('.tsx'))
/** A lockfile names packages, one of which may be called `retry`. */
const isLockfile = (path: string): boolean => path === 'package-lock.json'
/**
 * The tests and what runs them (the configs in the root, every package.json, the workflows, the
 * scripts), where a retry is a test's retry: the app has retries of its own, and a doc may talk
 * about either.
 */
const runsTests = (path: string): boolean =>
  !isDoc(path) && !isLockfile(path) && (isTest(path) || inRoot(path) || path.endsWith('/package.json') || path.startsWith(WORKFLOWS) || path.startsWith('scripts/'))
const takesScreenshots = (path: string): boolean => path.startsWith('e2e/') || (inRoot(path) && path.startsWith('playwright'))

/** Whether the guard compares the file's two versions whole, rather than only the lines added. */
export const readsWhole = (path: string): boolean =>
  path === CHECKS_FILE || path === LINT_FILE || path === PACKAGE_FILE || isWorkflow(path) || isTestCode(path) || path === TOKENS_FILE

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
    let value: Json | undefined
    try {
      value = JSON.parse(text) as Json
    } catch {
      // Not JSON: left undefined, which is not an object either.
    }
    return isObject(value) ? value : undefined
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
/** A budget, where more is weaker: the size check (scripts/size/) fails over it. */
const BUDGETS = 'budgets'
const isBudget = (key: string): boolean => key === BUDGETS || key.startsWith(`${BUDGETS}.`)

/**
 * An accessibility budget's path, `budgets.accessibility.<spec>.<state>.<rule>`: a rule its state
 * doesn't name counts as 0 there (scripts/accessibility/budget.ts), so a new rule's budget in a state
 * main has budgets for is one raised from 0. A new state's budgets are new ones, and so is a path
 * with a dot in a key, which the read refuses anyway.
 */
const ACCESSIBILITY = `${BUDGETS}.accessibility.`
const RULE_DEPTH = 5

/** Whether a budget's key is a rule's in an accessibility state main has budgets for, `{}` included. */
function inStateOnMain(key: string, base: JsonObject): boolean {
  const path = key.split('.')
  if (!key.startsWith(ACCESSIBILITY) || path.length !== RULE_DEPTH) return false
  let value: Json | undefined = base
  for (const part of path.slice(0, -1)) value = isObject(value) && Object.hasOwn(value, part) ? value[part] : undefined
  return isObject(value)
}

/**
 * A budget against main's: raised, removed or no longer a number is a weakening; a new one is a change
 * to existing checks, since a script can't tell whether it is tight; a lowered one is a stricter check.
 * `unnamed` says main's budget is the 0 a rule its accessibility state doesn't name counts as.
 */
function compareBudget(key: string, before: Json | undefined, after: Json | undefined, unnamed: boolean): Pick<Finding, 'needs' | 'what'> | undefined {
  const change = `${unnamed ? "nothing (`0` for a rule its state on main doesn't name)" : show(before)} → ${show(after)}`
  if (before === undefined) return { needs: 'review', what: `the budget \`${key}\` is new: ${change}` }
  if (after === undefined) return { needs: 'owner', what: `the budget \`${key}\` is removed: ${change}` }
  if (typeof after !== 'number') return { needs: 'owner', what: `the budget \`${key}\` is no longer a number: ${change}` }
  if (typeof before !== 'number') return { needs: 'review', what: `the budget \`${key}\` wasn't a number on main: ${change}` }
  return after > before ? { needs: 'owner', what: `the budget \`${key}\` is raised: ${change}` } : undefined
}

const entries = (value: Json | undefined): string[] => (Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)) : [])

/**
 * checks.json, the thresholds, the exclusion lists and the budgets: a threshold that went down, an
 * exclusion list that grew, a list of what is checked that shrank or a budget that went up is a
 * weakening; a budget that went down is a stricter check; any other change to the file is a change to
 * existing checks.
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
      // Not higher is lower here: one that stayed as it was never gets this far.
      const lowered = typeof before === 'number' && !(typeof after === 'number' && after > before)
      if (lowered) owner(`the threshold \`${key}\` is lowered: ${show(before)} → ${show(after)}`)
      else review(`the threshold \`${key}\` changed: ${show(before)} → ${show(after)}`)
    } else if (isBudget(key)) {
      const unnamed = before === undefined && inStateOnMain(key, parsed.base)
      const finding = compareBudget(key, unnamed ? 0 : before, after, unnamed)
      if (finding) found.push({ ...finding, file })
    } else if (EXCLUDES.includes(key) || INCLUDES.includes(key)) {
      // Anything but a list there, and whatever reads it leaves out or takes in something else.
      if (!Array.isArray(after)) {
        owner(`\`${key}\` is no longer a list the guard can read: ${show(before)} → ${show(after)}`)
        continue
      }
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

/** The rank of a rule that fails the run; main's rule with a severity the guard can't read counts as one. */
const ERROR = 2

/** A lint rule's severity as a rank, 0 for off; undefined for a value the guard doesn't know. */
function rank(rule: Json | undefined): number | undefined {
  const severity = Array.isArray(rule) ? rule[0] : rule
  if (severity === 'off' || severity === 'allow' || severity === 0) return 0
  if (severity === 'warn' || severity === 1) return 1
  if (severity === 'error' || severity === 'deny' || severity === ERROR) return ERROR
  return undefined
}

/** A rule's options: what follows its severity. */
const options = (rule: Json | undefined): Json[] => (Array.isArray(rule) ? rule.slice(1) : [])

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
    } else if (now < (was ?? ERROR)) {
      found.push({ needs: 'owner', file, what: `${rule} is ${now === 0 ? 'turned off' : 'downgraded'}: ${show(before)} → ${show(after)}` })
    } else if (was === undefined) {
      found.push({ needs: 'review', file, what: `${rule} had a severity on main the guard can't read: ${show(before)} → ${show(after)}` })
    } else if (!same(options(before), options(after))) {
      // Also with a higher severity: ["warn", { max: 2 }] → ["error", { max: 200 }] may check less.
      found.push({ needs: 'review', file, what: `${rule} has other options: ${show(before)} → ${show(after)}` })
    }
    // What is left is a rule as strict or stricter with the options it had: nothing to mark.
  }
  return found
}

const rulesOf = (config: Json | undefined): JsonObject => (isObject(config) && isObject(config.rules) ? config.rules : {})
const overridesOf = (config: JsonObject): Json[] => (Array.isArray(config.overrides) ? config.overrides : [])
const filesOf = (override: Json): string => JSON.stringify(isObject(override) ? override.files : override)

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
  const found = [...compareRules(file, '', rulesOf(was), rulesOf(now)), ...compareScope(file, '', was, now, ['overrides', 'ignorePatterns', '$schema'])]
  for (const pattern of entries(now.ignorePatterns)) {
    if (!entries(was.ignorePatterns).includes(pattern)) found.push({ needs: 'owner', file, what: `the linter skips more: ${pattern} is added to \`ignorePatterns\`` })
  }
  const before = new Map(overridesOf(was).map((override) => [filesOf(override), override]))
  const after = new Map(overridesOf(now).map((override) => [filesOf(override), override]))
  for (const files of new Set([...before.keys(), ...after.keys()])) {
    const where = ` for ${files}`
    found.push(...compareRules(file, where, rulesOf(before.get(files)), rulesOf(after.get(files)), after.has(files) ? rulesOf(was) : {}))
    const [had, has] = [before.get(files), after.get(files)]
    // An override that is gone takes its rules away, compared above; one that is new is read against
    // an empty one, so the environments and globals it brings are marked.
    if (!isObject(has)) continue
    if (!isObject(had)) {
      found.push(...compareScope(file, where, {}, has, ['files', 'excludeFiles']))
      continue
    }
    for (const pattern of entries(has.excludeFiles)) {
      if (!entries(had.excludeFiles).includes(pattern)) found.push({ needs: 'owner', file, what: `the lint rules${where} skip more: ${pattern} is added to \`excludeFiles\`` })
    }
    found.push(...compareScope(file, where, had, has, ['files', 'excludeFiles']))
  }
  return found
}

/**
 * What decides where and how the rules of the config or of one override apply, besides the rules
 * themselves and the keys `skip` names, which the caller reads: a plugin removed (and its rules
 * with it), an environment turned on or a global allowed (which `no-undef` then lets through) go to
 * the owner, and any other key changed, one the guard has no rule for included, to a second review.
 */
function compareScope(file: string, where: string, had: JsonObject, has: JsonObject, skip: string[]): Finding[] {
  const found: Finding[] = []
  for (const key of ['plugins', 'jsPlugins']) {
    for (const plugin of entries(had[key])) {
      if (!entries(has[key]).includes(plugin)) found.push({ needs: 'owner', file, what: `the lint plugin ${plugin} is removed${where}, and its rules with it` })
    }
  }
  const [envWas, envNow] = [isObject(had.env) ? had.env : {}, isObject(has.env) ? has.env : {}]
  for (const [name, on] of Object.entries(envNow)) {
    if (on === true && envWas[name] !== true) found.push({ needs: 'owner', file, what: `the environment ${name} is turned on${where}, and its globals with it` })
  }
  // An environment turned off, or a global taken away, that is no longer there gives back what the
  // defaults or the top level allow.
  for (const [name, on] of Object.entries(envWas)) {
    if (on === false && !(name in envNow)) found.push({ needs: 'owner', file, what: `the environment ${name} is no longer turned off${where}` })
  }
  const [globalsWas, globalsNow] = [isObject(had.globals) ? had.globals : {}, isObject(has.globals) ? has.globals : {}]
  for (const [name, value] of Object.entries(globalsNow)) {
    // `off` takes a global away; any other value lets it through.
    if (value !== 'off' && !same(globalsWas[name], value)) found.push({ needs: 'owner', file, what: `the global \`${name}\` is allowed${where}: ${show(value)}` })
  }
  for (const [name, value] of Object.entries(globalsWas)) {
    if (value === 'off' && !(name in globalsNow)) found.push({ needs: 'owner', file, what: `the global \`${name}\` is no longer taken away${where}` })
  }
  for (const key of new Set([...Object.keys(had), ...Object.keys(has)])) {
    if (['rules', 'plugins', 'jsPlugins', 'env', 'globals', ...skip].includes(key) || same(had[key], has[key])) continue
    found.push({ needs: 'review', file, what: `\`${key}\`${where} changed: ${show(had[key])} → ${show(has[key])}` })
  }
  return found
}

/**
 * package.json's scripts, which CI's steps and the author's own checks call: one removed is a
 * weakening, since the step that called it checks nothing; one changed is a change to an existing
 * check, since a script can't tell whether it does less.
 */
export function compareScripts(base: string | undefined, head: string | undefined, file = PACKAGE_FILE): Finding[] {
  if (base === undefined || head === undefined) return []
  const parsed = parseBoth(file, base, head)
  if ('needs' in parsed) return [parsed]
  const scripts = (json: JsonObject): JsonObject => (isObject(json.scripts) ? json.scripts : {})
  const [was, now] = [scripts(parsed.base), scripts(parsed.head)]
  return Object.keys(was).flatMap((name): Finding[] => {
    if (now[name] === undefined) return [{ needs: 'owner', file, what: `the npm script \`${name}\` is removed: ${show(was[name])}` }]
    if (same(was[name], now[name])) return []
    return [{ needs: 'review', file, what: `the npm script \`${name}\` changed: ${show(was[name])} → ${show(now[name])}` }]
  })
}

/** How YAML starts a block of lines under a key: `|` or `>`, with how it ends (`-`, `+`) and its indentation (`2`) if given. */
const BLOCK = /^[|>][-+\d]*$/

/**
 * A workflow's steps, each as what it runs: an action without its version (so a bump isn't a change)
 * or a command. Read line by line rather than as YAML, which Node can't parse without a dependency:
 * a `run:` or `uses:` key and, for a block, the lines indented under it, without its comments.
 */
export function workflowSteps(text: string): string[] {
  const steps: string[] = []
  let block: { indent: number; lines: string[] } | undefined
  const close = () => {
    if (block) steps.push(`run: ${block.lines.join(' ; ')}`)
    block = undefined
  }
  for (const line of text.split('\n')) {
    const command = line.trim()
    if (block && (command === '' || line.indexOf(command) > block.indent)) {
      if (command !== '' && !command.startsWith('#')) block.lines.push(command)
      continue
    }
    close()
    const key = /^(\s*(?:-\s+)?)(uses|run):(.*)/.exec(line)
    if (!key) continue
    const value = key[3].trim()
    // Without its version, the quotes it may be written in and a comment after it: the same action either way.
    if (key[2] === 'uses') steps.push(`uses: ${value.split('@')[0].replace(/["']/g, '').replace(/\s+#.*/, '')}`)
    else if (BLOCK.test(value)) block = { indent: key[1].length, lines: [] }
    // A `run:` with nothing after it is a mapping (`defaults: run: shell: bash`), not a step.
    else if (value !== '') steps.push(`run: ${value}`)
  }
  close()
  return steps
}

const brief = (step: string): string => (step.length > 120 ? `${step.slice(0, 117)}…` : step)

/**
 * The commands a step calls that can be a check: an npm script, a tool through npx with its
 * subcommand, a script through node, docker with its subcommand. Without their arguments, so a flag
 * added isn't another command. A step that calls an action, or a job that calls a reusable
 * workflow, is that one command: what it `uses`, whose version and inputs aren't part of the step.
 * The words are read wherever they stand, in a message too (`echo "the docker image"`): the guard
 * marks too much rather than too little.
 */
export function commands(step: string): string[] {
  if (step.startsWith('uses: ')) return [step]
  const npm = [...step.matchAll(/\bnpm (run )?(?:-\S+ )*([\w:.-]+)/g)].map(([, run, name]) => `npm ${run ?? ''}${name}`)
  const npx = [...step.matchAll(/\bnpx (?:-\S+ )*(\S+)(?: ([a-z][\w-]*))?/g)].map(([, tool, subcommand]) => `npx ${tool}${subcommand ? ` ${subcommand}` : ''}`)
  const node = [...step.matchAll(/\bnode (?!-)(\S+)/g)].map(([, script]) => `node ${script}`)
  const docker = [...step.matchAll(/\bdocker (?:-\S+ )*([a-z][\w-]*)/g)].map(([, subcommand]) => `docker ${subcommand}`)
  return [...npm, ...npx, ...node, ...docker]
}

/**
 * The CI workflows a branch changes, together: a command, an action or a reusable workflow that main's copies called
 * and none of the branch's calls is a weakening, wherever its step went; a workflow removed is one
 * too. Any other step that is gone (a command with other arguments, one of two steps alike, a step
 * of plain shell) is a change to an existing check. A command that an unchanged workflow still calls is
 * marked all the same: the guard reads only what the branch changes.
 */
export function compareWorkflows(workflows: Change[]): Finding[] {
  const stepsOf = (text: string | undefined): string[] => (text === undefined ? [] : workflowSteps(text))
  const called = new Set(workflows.flatMap(({ head }) => stepsOf(head).flatMap(commands)))
  const dropped = new Set<string>()
  return workflows.flatMap(({ path: file, base, head }): Finding[] => {
    const [was, left] = [stepsOf(base), stepsOf(head)]
    const gone = was.filter((step) => {
      const index = left.indexOf(step)
      if (index === -1) return true
      left.splice(index, 1)
      return false
    })
    const found: Finding[] = head === undefined ? [{ needs: 'owner', file, what: 'the workflow is removed, and its steps with it' }] : []
    for (const step of gone) {
      const lost = commands(step).filter((command) => !called.has(command))
      for (const command of lost.filter((command) => !dropped.has(command))) {
        dropped.add(command)
        found.push({ needs: 'owner', file, what: `a command CI ran is no longer run: \`${command}\`` })
      }
      if (lost.length === 0 && head !== undefined) found.push({ needs: 'review', file, what: `a CI step changed or is gone, it was: \`${brief(step)}\`` })
    }
    return found
  })
}

/**
 * What a line the branch adds can bring in, in which files it counts, what it calls for and what
 * the finding says. Retries: `retries` as a name in the code (a key with anything but 0, a variable
 * assigned or passed on), `retry` as a key with any value but 0, a mock or a function (the app's own
 * `retry: vi.fn()` and `retry: () => void`), and either as a command's flag. A condition on a step goes to a second review, not to
 * the owner: most are fair (`if: always()` on a summary), and a script can't tell.
 */
const ADDED: { pattern: RegExp; counts: (path: string) => boolean; needs: Needs; what: string }[] = [
  {
    pattern: /\bretries\b(?!["']?: ?0\b)(?=["']?\]?\s*[:=]|\s*[,})\]])|\bretry["']?\s*:\s*(?!0\b|vi\.fn\b|(?:async\s*)?\(|function\b)\S|--retr(?:y|ies)\b/,
    counts: runsTests,
    needs: 'owner',
    what: 'test retries appeared',
  },
  { pattern: /maxDiffPixel|\bthreshold["']?:/, counts: takesScreenshots, needs: 'owner', what: 'a screenshot tolerance appeared' },
  {
    pattern: /(?:oxlint|eslint)-disable|(?:v8|c8|istanbul) ignore|Stryker disable|@ts-(?:ignore|expect-error|nocheck)/,
    counts: (path) => !isDoc(path),
    needs: 'owner',
    what: 'a check is turned off in the code',
  },
  { pattern: /\btest(?:\.describe)?\.(?:skip|fixme|fail)\b/, counts: (path) => path.startsWith('e2e/'), needs: 'owner', what: 'a test is skipped or expected to fail' },
  { pattern: /\b(?:it|test|describe)\.(?:todo|skipIf|runIf)\b/, counts: isUnitTest, needs: 'owner', what: 'a test is skipped' },
  { pattern: /\bignoreSnapshots\b|\bupdateSnapshots\b|--ignore-snapshots(?![\w-])/, counts: runsTests, needs: 'owner', what: 'screenshots are no longer compared' },
  { pattern: /continue-on-error:(?! ?false\b)|\|\| ?(?:true\b|:(?!\S)|exit 0\b)|\bset \+e\b/, counts: isWorkflow, needs: 'owner', what: 'a CI step can fail without failing the run' },
  { pattern: /^\s*paths(?:-ignore)?:/, counts: isWorkflow, needs: 'owner', what: 'a workflow got a path filter, so it runs for fewer changes' },
  { pattern: /^\s*(?:- )?if:/, counts: isWorkflow, needs: 'review', what: 'a CI step or job got a condition' },
  // In a workflow other than the guard's own, whose every change is marked: what can report under the guard's name. A job by its key
  // or its name, a commit status by its context, a check run by its name as a field of an API call, in its JSON or in a script's call.
  { pattern: /^\s*(?:(?:- )?name: +)?["']?guard["']?:?\s*(?:#.*)?$|\bcontext["']?[=:] *["']?guard\b|\bname(?:=["']?guard\b|["']?: *["']guard["'])/, counts: isWorkflow, needs: 'owner', what: "a job or a status with the guard's name, which can report in its place" },
]

/** The lines a branch adds to one file, against the patterns above. */
export function scanAdded(file: string, added: AddedLine[]): Finding[] {
  return ADDED.filter(({ counts }) => counts(file)).flatMap(({ pattern, needs, what }) =>
    added.filter(({ text }) => pattern.test(text)).map(({ line, text }) => ({ needs, file, line, what: `${what}: \`${brief(text.trim())}\`` })),
  )
}

/** The design tokens' file against main's: a token added, changed or removed is a design decision, the coordinator's. */
export function compareTokens(base: string | undefined, head: string | undefined, file = TOKENS_FILE): Finding[] {
  if (head === undefined) return [{ needs: 'coordinator', file, what: 'the design tokens are removed, all of them' }]
  const read = (text: string | undefined): { tokens: Map<string, string>; atRules: string[] } | string => {
    if (text === undefined) return { tokens: new Map(), atRules: [] }
    try {
      return { tokens: tokensIn(text), atRules: atRulesIn(text) }
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const [was, now] = [read(base), read(head)]
  if (typeof now === 'string') return [{ needs: 'coordinator', file, what: `the guard can't read the file as a stylesheet, so it can't compare its tokens: ${now}` }]
  if (typeof was === 'string') return [{ needs: 'coordinator', file, what: `the guard can't read main's copy as a stylesheet, so every token here is as good as new: ${was}` }]
  const tokens = [...new Set([...was.tokens.keys(), ...now.tokens.keys()])].flatMap((key): Finding[] => {
    const [before, after] = [was.tokens.get(key), now.tokens.get(key)]
    if (before === after) return []
    const [where, prop] = key.split('\t')
    const token = `${prop.startsWith('--') ? 'the design token' : 'the declaration'} \`${prop}\`${where ? ` in \`${where}\`` : ''}`
    const change = before === undefined ? `is added: \`${after}\`` : after === undefined ? `is removed: \`${before}\`` : `changed: \`${before}\` → \`${after}\``
    return [{ needs: 'coordinator', file, what: `${token} ${change}` }]
  })
  // What the tokens can't be read from, such as an @import of another stylesheet: marked whole.
  const atRule = (rule: string, change: string): Finding => ({ needs: 'coordinator', file, what: `the at-rule \`${rule}\`, which holds no token the guard can read, is ${change}` })
  return [
    ...tokens,
    ...now.atRules.filter((rule) => !was.atRules.includes(rule)).map((rule) => atRule(rule, 'added')),
    ...was.atRules.filter((rule) => !now.atRules.includes(rule)).map((rule) => atRule(rule, 'removed')),
  ]
}

/**
 * The raw values a branch adds to a stylesheet that the tokens test lets through by the comment on
 * their line (stylesheets.ts): a design value too, which the coordinator approves. `sheets` are all
 * the app's stylesheets at the branch's head, which give the scale and the custom properties a
 * shadow is followed into; a changed line is an added one, so a comment written on a raw value's
 * line is marked as well.
 */
export function compareStylesheets(changes: Change[], sheets: Sheet[]): Finding[] {
  let raw: ReturnType<typeof rawValues>
  try {
    raw = rawValues(sheets)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return changes
      .filter(({ path }) => path !== TOKENS_FILE && sheets.some(({ file }) => file === path))
      .map(({ path }) => ({ needs: 'coordinator', file: path, what: `the guard can't read the stylesheets, so it can't tell which values this one adds: ${why}` }))
  }
  // rawValues names only the stylesheets it checks, so another file the branch changes finds none.
  return changes.flatMap(({ path, added }) => {
    const lines = new Set(added.map(({ line }) => line))
    return raw.filter(({ allowed }) => allowed).flatMap(({ file, line, prop, raw: value, via }): Finding[] => {
      if (file === path && lines.has(line)) return [{ needs: 'coordinator', file: path, line, what: `a value off the tokens' scale, let through by the comment on its line: \`${prop}: ${value}\`` }]
      // A line that takes a shadow from a custom property makes it cast one, though its own line stays.
      return via
        .filter((use) => use.file === path && lines.has(use.line))
        .map((use) => ({ needs: 'coordinator', file: path, line: use.line, what: `a shadow off the tokens' scale, taken from \`${file}:${line}\` and let through by the comment there: \`${prop}: ${value}\`` }))
    })
  })
}

/**
 * Every finding in a branch's changes. `sheets` are the app's stylesheets at the branch's head, which
 * guard.ts reads when the branch changes one.
 */
export function findings(changes: Change[], sheets: Sheet[] = []): Finding[] {
  const files = changes.flatMap(({ path, base, head, added }): Finding[] => {
    // The guard's own files hold these patterns as text, and each change to them goes to the owner anyway.
    if (isGuard(path)) return [{ needs: 'owner', file: path, what: 'the checks guard or its rules changed' }]
    if (path === CHECKS_FILE) return compareChecks(base, head)
    if (path === LINT_FILE) return compareLint(base, head)
    if (path === TOKENS_FILE) return [...compareTokens(base, head), ...scanAdded(path, added)]
    // By its path alone, whatever it says: these files are rare, and what they say is the reviews' to read.
    const lines = added.length > 0
    const byPath: Finding[] = [
      ...(isNestedLintConfig(path) && lines ? [{ needs: 'owner' as const, file: path, what: 'a lint config outside the root, which the linter obeys for its folder, is added or changed' }] : []),
      ...(isLintIgnore(path) && lines ? [{ needs: 'owner' as const, file: path, what: 'a file of paths the linter skips is added or changed' }] : []),
      ...(isTypeCheckConfig(path) ? [{ needs: 'review' as const, file: path, what: "the type check's config changed" }] : []),
    ]
    return [...byPath, ...(path === PACKAGE_FILE ? compareScripts(base, head) : []), ...scanAdded(path, added), ...(isTestCode(path) ? compareAssertions(path, base, head) : [])]
  })
  return [...files, ...compareStylesheets(changes, sheets), ...compareWorkflows(changes.filter(({ path }) => isWorkflow(path) && !isGuard(path)))]
}

/** The marker the workflow finds the guard's comment on a PR by. */
export const MARKER = '<!-- checks-guard -->'

const list = (found: Finding[]): string[] => found.map(({ file, line, what }) => (file ? `- \`${file}${line ? `:${line}` : ''}\`: ${what}` : `- ${what}`))

/**
 * The guard's report, as Markdown: the comment on the PR, the job's summary and what `npm run guard`
 * prints. `records` is what to say under each list of the record it needs (records.ts).
 */
export function report(found: Finding[], { head, base }: { head: string; base: string }, records: { [needs in Needs]?: string } = {}): string {
  const owner = found.filter(({ needs }) => needs === 'owner')
  const coordinator = found.filter(({ needs }) => needs === 'coordinator')
  const review = found.filter(({ needs }) => needs === 'review')
  const record = (needs: Needs): string[] => (records[needs] ? ['', records[needs]] : [])
  const lines = [MARKER, `**Checks guard at ${head}**, against \`main\` at ${base}.`]
  if (found.length === 0) lines.push('', 'No weakening of the checks, no change to existing ones and no design value added or changed.')
  if (owner.length > 0) lines.push('', `**For the owner: ${owner.length} to approve, each with a reason.** A weakening of the checks, or a change to the guard or its rules.`, '', ...list(owner), ...record('owner'))
  if (coordinator.length > 0) {
    lines.push('', `**For the coordinator: ${coordinator.length} to approve, each with a reason.** A design value added, changed or removed: a token, or a value off the tokens' scale that a comment lets through.`, '', ...list(coordinator), ...record('coordinator'))
  }
  if (review.length > 0) lines.push('', `**For a second review: ${review.length}.** Changes to existing checks, which a script can't judge.`, '', ...list(review), ...record('review'))
  return lines.join('\n')
}
