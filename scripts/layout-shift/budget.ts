// The layout shift budget's rules: the budgets read from checks.json and the verdict on a load's
// shifts. Pure, with no Node or browser APIs: the browser test (e2e/performance/layoutShift.perf.ts)
// records the shifts and hands them here (docs/TESTING.md → The layout shift test).

/** How far each screen may move as it loads, by window size, from `budgets.layoutShift` in checks.json. */
export type Budgets = Record<string, Record<string, number>>

/**
 * One layout shift: its score, the elements that moved (each with its box before and after), and
 * whether it came within 500 ms of a click or a key press, which web-vitals leaves out and this
 * reading counts, since a screen reached by a click loads in that window.
 */
export type Shift = { value: number; sources: string[]; afterInput: boolean }

/** What the check found: whether it passes, and what to say when it doesn't. */
export type Verdict = { passed: boolean; total: number; report: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
/** A budget as it was read: a number too large for JSON reads as Infinity, which `JSON.stringify` would show as `null`. */
const shown = (budget: unknown) => (typeof budget === 'number' ? String(budget) : JSON.stringify(budget))
const where = (...path: string[]) => `\`budgets.layoutShift${path.map((key) => `[${JSON.stringify(key)}]`).join('')}\``

/**
 * The most a budget may be: the bound Web Vitals call good. A screen that moves more as it loads has
 * a bug to fix, not a budget to raise (docs/QUALITY.md → The layout shift budget).
 */
export const CEILING = 0.1

/**
 * The budgets in checks.json's object, or what is wrong with them: an object of window sizes, each an
 * object of screens, each a score of 0 or more and no more than `CEILING`. More is weaker.
 */
export function readBudgets(checks: unknown): Budgets | string[] {
  const budgets = isObject(checks) && isObject(checks.budgets) ? checks.budgets.layoutShift : undefined
  if (!isObject(budgets)) return [`${where()} in checks.json is ${budgets === undefined ? 'missing' : 'not an object of window sizes'}`]
  const problems: string[] = []
  for (const [size, screens] of Object.entries(budgets)) {
    if (!isObject(screens)) {
      problems.push(`${where(size)} is not an object of screens`)
      continue
    }
    for (const [screen, budget] of Object.entries(screens)) {
      // Number.isFinite takes no string or null, and no number JSON reads as Infinity.
      if (!(Number.isFinite(budget) && (budget as number) >= 0)) {
        problems.push(`${where(size, screen)} is not a layout shift of 0 or more: \`${shown(budget)}\``)
      } else if ((budget as number) > CEILING) {
        problems.push(
          `${where(size, screen)} is ${shown(budget)}, over the ceiling of ${CEILING}, the bound Web Vitals call good: a screen that moves more has a bug to fix, not a budget to raise`,
        )
      }
    }
  }
  return problems.length > 0 ? problems : (budgets as Budgets)
}

/** A screen the test reads in a window size. */
export type Read = { size: string; screen: string }

/**
 * The budgets for no screen the test reads, and the screens it reads with no budget: each screen of
 * the performance tests' list (e2e/performance/screens.ts) has a case at each size the test reads it
 * in, and a budget there.
 */
export function unmatched(budgets: Budgets, read: Read[]): string[] {
  const isRead = (size: string, screen: string) => read.some((one) => one.size === size && one.screen === screen)
  const stale = Object.entries(budgets).flatMap(([size, screens]) =>
    Object.keys(screens)
      .filter((screen) => !isRead(size, screen))
      .map((screen) => `${where(size, screen)} is a budget for a screen the test doesn't read: take it out of checks.json, or give the screen a case in layoutShift.perf.ts`),
  )
  const missing = read
    .filter(({ size, screen }) => budgets[size]?.[screen] === undefined)
    .map(({ size, screen }) => `${where(size, screen)} is missing for a screen the test reads: add it to checks.json`)
  return [...stale, ...missing]
}

/**
 * The screens of the list (`listed`) with no case, and the cases of a screen the list doesn't name:
 * a screen added to the list is read too, and a case reads a screen the requests test counts.
 */
export function uncased(listed: string[], cased: string[]): string[] {
  return [
    ...listed.filter((screen) => !cased.includes(screen)).map((screen) => `The ${screen} screen has no case in layoutShift.perf.ts: give it one with its chain of answers`),
    ...[...new Set(cased)].filter((screen) => !listed.includes(screen)).map((screen) => `A case reads the ${screen} screen, which e2e/performance/screens.ts doesn't list`),
  ]
}

/** The layout shift of a load: the sum of all its shifts, rather than the worst window's as web-vitals takes. */
export const total = (shifts: Shift[]): number => shifts.reduce((sum, shift) => sum + shift.value, 0)

/** One shift as a failure lists it: its score, whether it came after input, and what moved. */
const listed = (shift: Shift) => `- ${shift.value.toFixed(4)}${shift.afterInput ? ' (after input)' : ''}: ${shift.sources.join(', ')}`

/** A screen's load against its budget: its shifts summed may not be over it. */
export function judge({ size, screen }: { size: string; screen: string }, shifts: Shift[], budgets: Budgets): Verdict {
  const sum = total(shifts)
  const budget = budgets[size]?.[screen]
  if (budget === undefined) {
    return { passed: false, total: sum, report: `${where(size, screen)} is missing for a screen the test opens: add it to checks.json` }
  }
  if (sum <= budget) return { passed: true, total: sum, report: '' }
  const report = [
    `The ${screen} screen (${size}) moved by ${sum.toFixed(4)} as it loaded, over its budget of ${budget} (${where(size, screen)}):`,
    ...shifts.map(listed),
  ].join('\n')
  return { passed: false, total: sum, report }
}

/** One load as the test reads it: the screen, its case and the order its answers landed in, and its layout shift. */
export type Reading = Read & { name: string; order: string; total: number }

/**
 * The loads' layout shifts as a Markdown table, a row each in the order given, with each screen's
 * budget: the reporter prints it and puts it in CI's job summary.
 */
export function table(readings: Reading[], budgets: Budgets): string {
  const rows = readings.map(
    ({ size, screen, name, order, total }) => `| ${size} | ${screen} | ${name} | ${order} | ${total.toFixed(4)} | ${budgets[size]?.[screen] ?? 'none'} |`,
  )
  return ['### Layout shift', '', '| Size | Screen | Case | Order | Layout shift | Budget |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n')
}
