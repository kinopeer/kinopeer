import { describe, expect, it } from 'vitest'
import {
  accessibilityActuals,
  assemble,
  coverageActuals,
  HEALTH,
  JOBS,
  journeysActuals,
  layoutShiftActuals,
  pointer,
  requestsActuals,
  toolActuals,
  TOOLS,
  type Counted,
} from './actuals.ts'

const ROUTES = { '/qbt': 1, '/tmdb': 2 }
const CHECKS = {
  coverage: { thresholds: { lines: 96, branches: 93 } },
  budgets: {
    size: { js: 100, css: 20, rest: 50 },
    requests: { phone: { downloads: ROUTES, settings: ROUTES } },
    journeys: { phone: { 'download.1-row': ROUTES, 'download.2-back': ROUTES, 'tabs.1-search': ROUTES } },
    layoutShift: { phone: { downloads: 0.01, title: 0.01 } },
    accessibility: { downloads: { 'list-dark-ru': {}, 'select-dark-ru': { 'color-contrast': 1 } } },
  },
}

describe('pointer', () => {
  it('joins a path as a JSON Pointer, escaping the slashes and tildes in its names', () => {
    expect(pointer(['phone', 'download.1-row', '/qbt'])).toBe('/phone/download.1-row/~1qbt')
    expect(pointer(['a~/b'])).toBe('/a~0~1b')
    expect(pointer([])).toBe('')
  })
})

describe('toolActuals', () => {
  it('gives every budget of the tool a value, null where nothing was measured, and every counter', () => {
    expect(toolActuals('size', CHECKS, [{ path: ['js'], value: 90 }], { files: 12 })).toEqual({
      tool: 'size',
      values: [
        { key: '/js', value: 90 },
        { key: '/css', value: null },
        { key: '/rest', value: null },
      ],
      health: { files: 12 },
    })
  })

  it('keeps a measured 0 as 0, and a value with no budget after those with one', () => {
    const part = toolActuals('size', CHECKS, [{ path: ['css'], value: 0 }, { path: ['wasm'], value: 7 }])
    expect(part.values).toEqual([
      { key: '/js', value: null },
      { key: '/css', value: 0 },
      { key: '/rest', value: null },
      { key: '/wasm', value: 7 },
    ])
  })

  it('makes a value or a counter that is no finite number null, and a counter not counted null', () => {
    const part = toolActuals('journeys', {}, [{ path: ['a'], value: Number.NaN }, { path: ['b'], value: Infinity }], { moves: Number.NaN })
    expect(part.values).toEqual([
      { key: '/a', value: null },
      { key: '/b', value: null },
    ])
    expect(part.health).toEqual({ journeys: null, moves: null })
  })

  it.each([
    ['no checks.json', undefined],
    ['a list', []],
    ['no section', { budgets: {} }],
    ['a section that is a number', { budgets: { size: 3 } }],
  ])('measures without budgets when checks.json has %s', (_, checks) => {
    expect(toolActuals('size', checks, [{ path: ['js'], value: 5 }]).values).toEqual([{ key: '/js', value: 5 }])
  })

  it('names every counter of every tool', () => {
    for (const tool of TOOLS) expect(Object.keys(toolActuals(tool, CHECKS, []).health)).toEqual(HEALTH[tool])
  })
})

describe('assemble', () => {
  const part = toolActuals('size', CHECKS, [{ path: ['js'], value: 90 }], { files: 3 })

  it('puts the parts of the job’s tools in its order, and a tool with no part gets every value and counter null', () => {
    const made = assemble({ sha: 'abc', job: 'performance', parts: [part], checks: CHECKS })
    expect(made).toMatchObject({ schema: 1, sha: 'abc', job: 'performance' })
    expect(made.tools.map(({ tool }) => tool)).toEqual(JOBS.performance)
    expect(made.tools[0]).toEqual(part)
    expect(made.tools[3]).toEqual({
      tool: 'layoutShift',
      values: [
        { key: '/phone/downloads', value: null },
        { key: '/phone/title', value: null },
      ],
      health: { screens: null, loads: null },
    })
  })

  it('leaves out the parts of other jobs’ tools', () => {
    const coverage = coverageActuals({ total: { lines: { pct: 97 } } }, CHECKS)
    expect(assemble({ sha: 'abc', job: 'visual', parts: [part, coverage], checks: CHECKS }).tools.map(({ tool }) => tool)).toEqual(['accessibility'])
  })

  it.each([
    ['nothing', undefined],
    ['a list', []],
    ['an unknown tool', { ...part, tool: 'speed' }],
    ['values that are no list', { ...part, values: {} }],
    ['a value without a key', { ...part, values: [{ value: 1 }] }],
    ['a value that is a string', { ...part, values: [{ key: '/js', value: '90' }] }],
    ['no health', { ...part, health: undefined }],
    ['a counter that is a string', { ...part, health: { files: '3' } }],
  ])('takes a part with %s as no part', (_, broken) => {
    const [size] = assemble({ sha: 'abc', job: 'performance', parts: [broken], checks: CHECKS }).tools
    expect(size.health).toEqual({ files: null })
    expect(size.values.every(({ value }) => value === null)).toBe(true)
  })

  it('takes null values and counters as a part’s own', () => {
    const nulls = toolActuals('size', CHECKS, [])
    expect(assemble({ sha: 'abc', job: 'performance', parts: [nulls], checks: {} }).tools[0]).toEqual(nulls)
  })

  it.each(['smoke', 'toString'])('throws for the %s job, which measures nothing', (job) => {
    expect(() => assemble({ sha: 'abc', job, parts: [], checks: CHECKS })).toThrow(`The ${job} job measures nothing: the jobs that do are check, performance, visual`)
  })
})

describe('coverageActuals', () => {
  it('reads each metric’s percentage and counts the files', () => {
    const summary = {
      total: { lines: { pct: 97.5 }, statements: { pct: 96 }, functions: { pct: 95.1 }, branches: { pct: 'Unknown' } },
      '/repo/src/a.ts': { lines: { pct: 100 } },
      '/repo/src/b.ts': { lines: { pct: 90 } },
    }
    expect(coverageActuals(summary, CHECKS)).toEqual({
      tool: 'coverage',
      values: [
        { key: '/lines', value: 97.5 },
        // No number in the report: not measured.
        { key: '/branches', value: null },
        { key: '/statements', value: 96 },
        { key: '/functions', value: 95.1 },
      ],
      health: { files: 2 },
    })
  })

  it.each([
    ['no report', undefined],
    ['no totals', { '/repo/src/a.ts': {} }],
  ])('gives null values and counter for %s', (_, summary) => {
    expect(coverageActuals(summary, CHECKS)).toEqual({
      tool: 'coverage',
      values: [
        { key: '/lines', value: null },
        { key: '/branches', value: null },
      ],
      health: { files: null },
    })
  })

  it('skips a metric that is no object', () => {
    expect(coverageActuals({ total: { lines: 97 } }, {}).values).toEqual([])
  })
})

describe('requestsActuals', () => {
  it('gives each screen’s count per route and how many screens were opened', () => {
    const opened: Counted[] = [{ size: 'phone', screen: 'downloads', counts: { '/qbt': 1, '/tmdb': 3 } }]
    expect(requestsActuals(opened, CHECKS)).toEqual({
      tool: 'requests',
      values: [
        { key: '/phone/downloads/~1qbt', value: 1 },
        { key: '/phone/downloads/~1tmdb', value: 3 },
        { key: '/phone/settings/~1qbt', value: null },
        { key: '/phone/settings/~1tmdb', value: null },
      ],
      health: { screens: 1 },
    })
  })
})

describe('journeysActuals', () => {
  it('gives each move’s count per route, the moves made and the journeys they were in, per window size', () => {
    const moves: Counted[] = [
      { size: 'phone', screen: 'download.1-row', counts: { '/qbt': 0 } },
      { size: 'phone', screen: 'download.2-back', counts: { '/qbt': 0 } },
      { size: 'phone', screen: 'tabs.1-search', counts: { '/qbt': 2 } },
      { size: 'desktop', screen: 'tabs.1-search', counts: { '/qbt': 1 } },
    ]
    const part = journeysActuals(moves, CHECKS)
    expect(part.health).toEqual({ journeys: 3, moves: 4 })
    expect(part.values).toContainEqual({ key: '/phone/download.1-row/~1qbt', value: 0 })
    expect(part.values).toContainEqual({ key: '/phone/download.1-row/~1tmdb', value: null })
    expect(part.values).toContainEqual({ key: '/desktop/tabs.1-search/~1qbt', value: 1 })
  })
})

describe('layoutShiftActuals', () => {
  it('gives each screen its largest load, the screens read and the loads', () => {
    const loads = [
      { size: 'phone', screen: 'downloads', total: 0.002 },
      { size: 'phone', screen: 'downloads', total: 0.03 },
      { size: 'phone', screen: 'downloads', total: 0.01 },
      { size: 'desktop', screen: 'downloads', total: 0 },
    ]
    expect(layoutShiftActuals(loads, CHECKS)).toEqual({
      tool: 'layoutShift',
      values: [
        { key: '/phone/downloads', value: 0.03 },
        { key: '/phone/title', value: null },
        { key: '/desktop/downloads', value: 0 },
      ],
      health: { screens: 2, loads: 3 + 1 },
    })
  })
})

describe('accessibilityActuals', () => {
  it('gives each rule a state has a budget for or axe found its count, 0 where axe found none, the states read and the passes summed', () => {
    const reads = [
      { spec: 'downloads', shot: 'select-dark-ru', violations: [], passes: 40 },
      { spec: 'downloads', shot: 'list-dark-ru', violations: [{ id: 'target-size', nodes: [{}, {}] }], passes: 38 },
      { spec: 'search', shot: 'new-dark-ru', violations: [{ id: 'region', nodes: [{}] }], passes: 30 },
    ]
    expect(accessibilityActuals(reads, CHECKS)).toEqual({
      tool: 'accessibility',
      values: [
        { key: '/downloads/select-dark-ru/color-contrast', value: 0 },
        { key: '/downloads/list-dark-ru/target-size', value: 2 },
        { key: '/search/new-dark-ru/region', value: 1 },
      ],
      health: { states: 3, passes: 108 },
    })
  })

  it('gives a budget of a state not read null', () => {
    expect(accessibilityActuals([], CHECKS)).toEqual({
      tool: 'accessibility',
      values: [{ key: '/downloads/select-dark-ru/color-contrast', value: null }],
      health: { states: 0, passes: 0 },
    })
  })
})
