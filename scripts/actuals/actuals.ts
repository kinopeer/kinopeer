// The actual values each measuring tool in CI read, machine-readable, for a collector outside this
// repository that charts them against their budgets over main's commits (docs/QUALITY.md → The
// actual values). Pure, with no Node APIs: each tool hands its numbers here, write.ts writes them.
//
// Each tool writes a part of its own (`ToolActuals`) as it measures, before its budget is judged, so
// a red run still has its numbers; at the end of the job collect.ts puts the parts of the job's tools
// into one file (`Actuals`), the tools that wrote none with every value null.

export const SCHEMA = 1

export const TOOLS = ['size', 'coverage', 'requests', 'journeys', 'layoutShift', 'accessibility'] as const
export type Tool = (typeof TOOLS)[number]

/** One value a tool read: the budget's key (`pointer`) and the value, null when it wasn't measured, never 0 for that. */
export type Value = { key: string; value: number | null }
/** How much a tool measured, by counter, so one that measured less shows even when its values equal their budgets. */
export type Health = Record<string, number | null>
/** What one tool read in a run. */
export type ToolActuals = { tool: Tool; values: Value[]; health: Health }
/** The file a job uploads as its `actuals-<job>` artifact. */
export type Actuals = { schema: typeof SCHEMA; sha: string; job: string; tools: ToolActuals[] }

/** Where each tool's budgets sit in checks.json: a value's key is its budget's place under this. */
export const SECTIONS: Record<Tool, string[]> = {
  size: ['budgets', 'size'],
  coverage: ['coverage', 'thresholds'],
  requests: ['budgets', 'requests'],
  journeys: ['budgets', 'journeys'],
  layoutShift: ['budgets', 'layoutShift'],
  accessibility: ['budgets', 'accessibility'],
}

/** Each tool's health counters, every one in its part, null when the tool didn't count it. */
export const HEALTH: Record<Tool, string[]> = {
  // The files in the build, or in the coverage report.
  size: ['files'],
  coverage: ['files'],
  // The screens opened, in each window size.
  requests: ['screens'],
  // The journeys made and the moves in them, in each window size.
  journeys: ['journeys', 'moves'],
  // The screens read, in each window size, and the loads read (each case and order of a screen).
  layoutShift: ['screens', 'loads'],
  // The screenshots' states axe read, and the rules it found passing, summed over them.
  accessibility: ['states', 'passes'],
}

/** The tools each CI job measures with. */
export const JOBS: Record<string, Tool[]> = {
  check: ['coverage'],
  performance: ['size', 'requests', 'journeys', 'layoutShift'],
  visual: ['accessibility'],
}

/**
 * A budget's key: its path under the tool's section as a JSON Pointer (RFC 6901), since the names in
 * a path have dots and slashes in them (a journey's `download.1-row`, a route's `/qbt`):
 * `['phone', 'downloads', '/qbt']` is `/phone/downloads/~1qbt`.
 */
export const pointer = (path: string[]): string => path.map((name) => `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The paths of every budget under `value`: each leaf that isn't an object. */
function leaves(value: unknown, path: string[] = []): string[][] {
  if (!isObject(value)) return path.length > 0 ? [path] : []
  return Object.entries(value).flatMap(([name, inner]) => leaves(inner, [...path, name]))
}

/** The object at `path` in checks.json's object, or undefined. */
const at = (checks: unknown, path: string[]): unknown => path.reduce<unknown>((value, name) => (isObject(value) ? value[name] : undefined), checks)

/** A value at a budget's path, null where the tool knows it measured nothing there. */
export type Measured = { path: string[]; value: number | null }

/**
 * A tool's part: a value for every budget of its section in checks.json (null where nothing was
 * measured for it) and for every path measured without one (an axe rule found where its state has
 * no budget for it), and each of its health counters (null where not counted). A value that isn't a
 * finite number is null.
 */
export function toolActuals(tool: Tool, checks: unknown, measured: Measured[], health: Partial<Health> = {}): ToolActuals {
  const values = new Map<string, number | null>(leaves(at(checks, SECTIONS[tool])).map((path) => [pointer(path), null]))
  for (const { path, value } of measured) values.set(pointer(path), Number.isFinite(value) ? value : null)
  const counted = (name: string) => {
    const count = health[name]
    return Number.isFinite(count) ? (count as number) : null
  }
  return {
    tool,
    values: [...values].map(([key, value]) => ({ key, value })),
    health: Object.fromEntries(HEALTH[tool].map((name) => [name, counted(name)])),
  }
}

/** Whether a part read back from a file has the shape a tool writes. */
function isToolActuals(part: unknown): part is ToolActuals {
  if (!isObject(part) || !(TOOLS as readonly unknown[]).includes(part.tool) || !isObject(part.health) || !Array.isArray(part.values)) return false
  const isCount = (value: unknown) => value === null || Number.isFinite(value)
  return part.values.every((value) => isObject(value) && typeof value.key === 'string' && isCount(value.value)) && Object.values(part.health).every(isCount)
}

/**
 * A job's file: the parts its tools wrote, in the order of `JOBS`, and for a tool that wrote none
 * (its step never ran, or broke before measuring) or wrote one that doesn't read, every value and
 * counter null. Throws for a job that doesn't measure.
 */
export function assemble({ sha, job, parts, checks }: { sha: string; job: string; parts: unknown[]; checks: unknown }): Actuals {
  if (!Object.hasOwn(JOBS, job)) throw new Error(`The ${job} job measures nothing: the jobs that do are ${Object.keys(JOBS).join(', ')}`)
  return {
    schema: SCHEMA,
    sha,
    job,
    tools: JOBS[job].map((tool) => parts.find((part): part is ToolActuals => isToolActuals(part) && part.tool === tool) ?? toolActuals(tool, checks, [])),
  }
}

// What each tool measured, as its reporter or script reads it.

/** A coverage metric's totals in Vitest's `json-summary` report: `pct` is `"Unknown"` when there is nothing to cover. */
const METRICS = ['lines', 'statements', 'functions', 'branches'] as const

/** Coverage's part from a `json-summary` report (`coverage/coverage-summary.json`): each metric's percentage, and the files in it. */
export function coverageActuals(summary: unknown, checks: unknown): ToolActuals {
  if (!isObject(summary) || !isObject(summary.total)) return toolActuals('coverage', checks, [])
  const total = summary.total
  const measured = METRICS.flatMap((metric) => {
    const pct = isObject(total[metric]) ? total[metric].pct : undefined
    return typeof pct === 'number' ? [{ path: [metric], value: pct }] : []
  })
  return toolActuals('coverage', checks, measured, { files: Object.keys(summary).filter((key) => key !== 'total').length })
}

/** A screen's opening or a move as requests.perf.ts and journeys.perf.ts attach it: its window size, its name and its count per route. */
export type Counted = { size: string; screen: string; counts: Record<string, number> }

/** The requests' part: each screen's count per route, and how many screens were opened. */
export function requestsActuals(opened: Counted[], checks: unknown): ToolActuals {
  return toolActuals('requests', checks, countsOf(opened), { screens: opened.length })
}

/** The journeys' part: each move's count per route, how many moves were made, and in how many journeys (a move's name is its journey's and its place, `download.1-row`). */
export function journeysActuals(moves: Counted[], checks: unknown): ToolActuals {
  const journeys = new Set(moves.map(({ size, screen }) => JSON.stringify([size, screen.split('.')[0]])))
  return toolActuals('journeys', checks, countsOf(moves), { journeys: journeys.size, moves: moves.length })
}

const countsOf = (measured: Counted[]): Measured[] =>
  measured.flatMap(({ size, screen, counts }) => Object.entries(counts).map(([route, value]) => ({ path: [size, screen, route], value })))

/** A load as layoutShift.perf.ts attaches it: its window size, its screen and its layout shift. */
export type Load = { size: string; screen: string; total: number }

/**
 * The layout shift's part: each screen's largest load, which is what its budget bounds (each load of
 * it is judged on its own), how many screens were read and how many loads.
 */
export function layoutShiftActuals(loads: Load[], checks: unknown): ToolActuals {
  const largest = new Map<string, { path: string[]; value: number }>()
  for (const { size, screen, total } of loads) {
    const key = pointer([size, screen])
    const seen = largest.get(key)
    if (!seen || total > seen.value) largest.set(key, { path: [size, screen], value: total })
  }
  return toolActuals('layoutShift', checks, [...largest.values()], { screens: largest.size, loads: loads.length })
}

/** A state as e2e/test.ts attaches it: its spec and screenshot, the elements breaking each rule axe found, and how many rules it found passing. */
export type Read = { spec: string; shot: string; violations: { id: string; nodes: unknown[] }[]; passes: number }

/**
 * The accessibility's part: in each state read, the elements breaking each rule it has a budget for
 * (0 where axe found none) or axe found, how many states were read and the passing rules summed over them.
 */
export function accessibilityActuals(reads: Read[], checks: unknown): ToolActuals {
  const budgets = at(checks, SECTIONS.accessibility)
  const measured = reads.flatMap(({ spec, shot, violations }) => {
    const budget = at(budgets, [spec, shot])
    const found = new Map(violations.map(({ id, nodes }) => [id, nodes.length]))
    const rules = new Set([...(isObject(budget) ? Object.keys(budget) : []), ...found.keys()])
    return [...rules].map((rule) => ({ path: [spec, shot, rule], value: found.get(rule) ?? 0 }))
  })
  return toolActuals('accessibility', checks, measured, { states: reads.length, passes: reads.reduce((sum, { passes }) => sum + passes, 0) })
}
