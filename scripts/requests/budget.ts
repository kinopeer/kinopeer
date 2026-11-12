// The requests budget's rules: which budget a request the page sent counts against, the budgets read
// from checks.json, and the verdict on a screen's counts. Pure, with no Node or browser APIs: the
// browser test (e2e/performance/requests.perf.ts) collects the requests and hands them here
// (docs/QUALITY.md → The requests budget).

/** Kinopeer's server routes the app calls, each counted on its own. */
export const ROUTES = ['/qbt', '/tmdb', '/tmdb-img', '/prowlarr', '/api'] as const
/**
 * The app's own origin outside those routes and the app's files: a server route `ROUTES` doesn't
 * name (`/healthz` today, or a new one), or a file the build doesn't have.
 */
export const OTHER_PATHS = 'other paths'
/** Any origin but the app's own: the app calls none, so its budget is 0 on every screen. */
export const ELSEWHERE = 'other origins'
export const KEYS = [...ROUTES, OTHER_PATHS, ELSEWHERE] as const
export type Key = (typeof KEYS)[number]

/** How many requests each key may take on a screen's open: exactly that many, not fewer. */
export type Counts = Record<Key, number>
/** `budgets.requests` in checks.json: by window size, then by screen. */
export type Budgets = Record<string, Record<string, Counts>>
/** A request the page sent; `document` when it loads the page itself (the app's address, which the server answers with `index.html`). */
export type Sent = { method: string; url: string; document?: boolean }
/** The app under test: its origin, and the paths of the files its build has (`/theme.js`, `/assets/…`), which aren't counted. */
export type App = { origin: string; files: ReadonlySet<string> }
/** A screen the test opens, in one window size. */
export type Opened = { size: string; screen: string }
/** What the check found: whether it passes, and its report as Markdown. */
export type Verdict = { passed: boolean; report: string }

/**
 * The key a request counts against, or null for what isn't a server's answer: the page itself, the
 * app's own files (its scripts and styles, the fonts, the icons, the manifest, `version.json`: what
 * the build has) and a URL that isn't fetched over the network (`data:`, `blob:`).
 */
export function keyOf({ url, document }: Sent, app: App): Key | null {
  const { protocol, origin, pathname } = new URL(url)
  if (protocol !== 'http:' && protocol !== 'https:') return null
  if (origin !== app.origin) return ELSEWHERE
  const route = ROUTES.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  if (route) return route
  return document || app.files.has(pathname) ? null : OTHER_PATHS
}

/** The requests each key counts, in the order they were sent. */
export function grouped(sent: Sent[], app: App): Record<Key, Sent[]> {
  const byKey = Object.fromEntries(KEYS.map((key) => [key, [] as Sent[]])) as Record<Key, Sent[]>
  for (const request of sent) {
    const key = keyOf(request, app)
    if (key !== null) byKey[key].push(request)
  }
  return byKey
}

/** How many requests each key counts. */
export const countsOf = (byKey: Record<Key, Sent[]>): Counts => Object.fromEntries(KEYS.map((key) => [key, byKey[key].length])) as Counts

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const where = (...path: string[]) => `\`budgets.requests${path.map((key) => `[${JSON.stringify(key)}]`).join('')}\``

/**
 * The budgets in checks.json's object, or what is wrong with them: an object of window sizes, each an
 * object of screens, each with a whole number of requests, 0 or more, for every key and no other.
 */
export function readBudgets(checks: unknown): Budgets | string[] {
  const requests = isObject(checks) && isObject(checks.budgets) ? checks.budgets.requests : undefined
  if (!isObject(requests)) return [`${where()} in checks.json is ${requests === undefined ? 'missing' : 'not an object of window sizes'}`]
  const problems: string[] = []
  for (const [size, screens] of Object.entries(requests)) {
    if (!isObject(screens)) {
      problems.push(`${where(size)} is not an object of screens`)
      continue
    }
    for (const [screen, counts] of Object.entries(screens)) {
      if (!isObject(counts)) {
        problems.push(`${where(size, screen)} is not an object of routes`)
        continue
      }
      for (const key of KEYS) {
        const budget = counts[key]
        if (!(typeof budget === 'number' && Number.isSafeInteger(budget) && budget >= 0)) {
          problems.push(`${where(size, screen, key)} is ${budget === undefined ? 'missing' : `not a whole number of requests, 0 or more: \`${JSON.stringify(budget)}\``}`)
        }
      }
      for (const key of Object.keys(counts).filter((key) => !(KEYS as readonly string[]).includes(key))) {
        problems.push(`${where(size, screen, key)} is no route the check counts (${KEYS.map((known) => `\`${known}\``).join(', ')})`)
      }
    }
  }
  return problems.length > 0 ? problems : (requests as Budgets)
}

/** The budgets with no screen the test opens, and the screens it opens with no budget. */
export function unmatched(budgets: Budgets, opened: Opened[]): string[] {
  const isOpened = (size: string, screen: string) => opened.some((one) => one.size === size && one.screen === screen)
  const stale = Object.entries(budgets).flatMap(([size, screens]) =>
    Object.keys(screens)
      .filter((screen) => !isOpened(size, screen))
      .map((screen) => `${where(size, screen)} is a budget for a screen the test doesn't open: take it out of checks.json, or open the screen in e2e/performance/requests.perf.ts`),
  )
  const missing = opened.filter(({ size, screen }) => budgets[size]?.[screen] === undefined).map(({ size, screen }) => noBudget(size, screen))
  return [...stale, ...missing]
}

const noBudget = (size: string, screen: string) => `${where(size, screen)} is missing for a screen the test opens: add it to checks.json with the counts the test measures`

const plural = (count: number) => `${count} request${count === 1 ? '' : 's'}`
/** A request as the report lists it: the path for the app's origin, the whole URL for another. */
const shown = ({ method, url }: Sent, appOrigin: string): string => {
  const parsed = new URL(url)
  return `${method} ${parsed.origin === appOrigin ? `${parsed.pathname}${parsed.search}` : url}`
}

/**
 * A screen's requests against its budget: each key's count must equal its budget. More is a request
 * the screen didn't send before; fewer is a budget left higher than the screen needs, which would let
 * a request come back unnoticed.
 */
export function judge({ size, screen, path }: Opened & { path: string }, sent: Sent[], app: App, budgets: Budgets): Verdict {
  const title = `## Requests on opening ${screen} (${size}, \`${path}\`)`
  const budget = budgets[size]?.[screen]
  if (budget === undefined) return { passed: false, report: [title, noBudget(size, screen)].join('\n\n') }
  const byKey = grouped(sent, app)
  const failures = KEYS.filter((key) => byKey[key].length !== budget[key]).map((key) => {
    const count = byKey[key].length
    const listed = count === 0 ? '  - none' : byKey[key].map((request) => `  - \`${shown(request, app.origin)}\``).join('\n')
    const advice =
      count > budget[key]
        ? 'More than the budget: find what sends the new ones (a request sent twice, one for what the screen doesn\'t show) and take them out. ' +
          'Raising a budget is the owner\'s decision, not a way to get a PR through (docs/QUALITY.md → The requests budget).'
        : `Fewer than the budget: lower ${where(size, screen, key)} in checks.json to ${count}.`
    return `- **\`${key}\`: ${plural(count)}, the budget is ${budget[key]}.** ${advice} Sent:\n${listed}`
  })
  return { passed: failures.length === 0, report: [title, ...(failures.length === 0 ? ['Every count is its budget.'] : failures)].join('\n\n') }
}

/** The counts of every screen opened, as a Markdown table for the job's summary. */
export function table(measured: (Opened & { counts: Counts })[]): string {
  const rows = [...measured]
    .sort((a, b) => a.size.localeCompare(b.size) || a.screen.localeCompare(b.screen))
    .map(({ size, screen, counts }) => `| ${size} | ${screen} | ${KEYS.map((key) => counts[key]).join(' | ')} |`)
  return [
    '## Requests on opening a screen',
    [`| Window | Screen | ${KEYS.map((key) => `\`${key}\``).join(' | ')} |`, `| --- | --- | ${KEYS.map(() => '---:').join(' | ')} |`, ...rows].join('\n'),
  ].join('\n\n')
}

/**
 * How long the test runs the page's clock after the page loads: 1 ms less than the shortest of the
 * app's poll intervals (`src/torrents/pollIntervals.ts`), so the timers a screen's open sets off fire
 * and no poll repeats. Or what is wrong with the intervals: the module exports only poll intervals,
 * each a whole number of milliseconds above 1, and at least one.
 */
export function clockRun(intervals: Record<string, unknown>): number | string[] {
  const entries = Object.entries(intervals)
  if (entries.length === 0) return ['`src/torrents/pollIntervals.ts` exports no poll interval, so the test has no time to run the clock for']
  const problems = entries
    .filter(([, ms]) => !(typeof ms === 'number' && Number.isSafeInteger(ms) && ms > 1))
    .map(([name, ms]) => `\`${name}\` in \`src/torrents/pollIntervals.ts\` is not a whole number of milliseconds above 1: ${typeof ms === 'function' ? 'a function' : `\`${typeof ms === 'number' ? ms : JSON.stringify(ms)}\``}; the module exports only poll intervals, which the test runs the clock by`)
  return problems.length > 0 ? problems : Math.min(...entries.map(([, ms]) => ms as number)) - 1
}

