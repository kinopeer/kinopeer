import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolActuals } from './actuals.ts'
import { main as collect } from './collect.ts'
import { main as coverage } from './coverage.ts'
import ActualsReporter from './reporter.ts'
import { CHECKS, readJson, writePart } from './write.ts'

/** A folder of its own per test. */
let root: string
const at = (path: string) => join(root, path)
const read = async (path: string) => JSON.parse(await readFile(at(path), 'utf8'))

const THRESHOLDS = { lines: 96, statements: 95, functions: 95, branches: 93 }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'actuals-'))
  await writeFile(at('checks.json'), JSON.stringify({ coverage: { thresholds: THRESHOLDS } }))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('writePart and readJson', () => {
  it('writes a part as <tool>.json, making the folder', async () => {
    const part = toolActuals('size', {}, [{ path: ['js'], value: 1 }])
    writePart(at('parts/deep'), part)
    expect(await read('parts/deep/size.json')).toEqual(part)
  })

  it('reads a JSON file, and undefined for one missing or broken', async () => {
    await writeFile(at('broken.json'), '{')
    expect(readJson(at('checks.json'))).toEqual({ coverage: { thresholds: THRESHOLDS } })
    expect(readJson(at('broken.json'))).toBeUndefined()
    expect(readJson(at('missing.json'))).toBeUndefined()
  })

  it('finds the repository’s checks.json', () => {
    expect(readJson(CHECKS)).toHaveProperty('coverage.thresholds')
  })
})

describe('coverage', () => {
  // Vitest writes the summary before it judges the thresholds; a run under them still records its numbers.
  it('writes the percentages of a report under the thresholds', async () => {
    const pct = (value: number) => ({ pct: value })
    await writeFile(at('summary.json'), JSON.stringify({ total: { lines: pct(80), statements: pct(81), functions: pct(82), branches: pct(83) }, '/a.ts': {} }))
    const part = coverage({ summary: at('summary.json'), checks: at('checks.json') }, { ACTUALS_DIR: at('parts') })
    expect(await read('parts/coverage.json')).toEqual(part)
    expect(part.values).toEqual([
      { key: '/lines', value: 80 },
      { key: '/statements', value: 81 },
      { key: '/functions', value: 82 },
      { key: '/branches', value: 83 },
    ])
    expect(part.health).toEqual({ files: 1 })
  })

  it('writes nulls without a report', async () => {
    coverage({ summary: at('none.json'), checks: at('checks.json') }, { ACTUALS_DIR: at('parts') })
    expect((await read('parts/coverage.json')).values.map(({ value }: { value: unknown }) => value)).toEqual([null, null, null, null])
  })

  it('writes nothing without ACTUALS_DIR', async () => {
    coverage({ summary: at('none.json'), checks: at('checks.json') }, {})
    expect(readJson(at('parts/coverage.json'))).toBeUndefined()
  })
})

describe('collect', () => {
  it('writes the job’s file from the parts in the folder, taking a file that isn’t JSON as no part', async () => {
    const part = toolActuals('coverage', {}, [{ path: ['lines'], value: 97 }], { files: 300 })
    writePart(at('parts'), part)
    await writeFile(at('parts/notes.txt'), 'not a part')
    const made = collect({ job: 'check', sha: 'abc123', dir: at('parts'), out: at('actuals-check.json'), checks: at('checks.json') })
    expect(made).toEqual({ schema: 1, sha: 'abc123', job: 'check', tools: [part] })
    expect(await read('actuals-check.json')).toEqual(made)
  })

  it('writes nulls for every budget when no tool wrote a part', async () => {
    const made = collect({ job: 'check', sha: 'abc123', dir: at('none'), out: at('out.json'), checks: at('checks.json') })
    expect(made.tools).toEqual([
      {
        tool: 'coverage',
        values: Object.keys(THRESHOLDS).map((metric) => ({ key: `/${metric}`, value: null })),
        health: { files: null },
      },
    ])
  })

  it('takes a part that can’t be parsed as none', async () => {
    await mkdir(at('parts'))
    await writeFile(at('parts/coverage.json'), '{')
    const made = collect({ job: 'check', sha: 'abc123', dir: at('parts'), out: at('out.json'), checks: at('checks.json') })
    expect(made.tools[0].health).toEqual({ files: null })
  })
})

describe('the scripts CI runs', () => {
  const run = (script: string, args: string[], env: Record<string, string>) =>
    execFileSync(process.execPath, [join(import.meta.dirname, script), ...args], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: 'pipe' })

  it('collect.ts writes actuals-<job>.json in the folder it runs in', async () => {
    writePart(at('parts'), toolActuals('coverage', {}, [{ path: ['lines'], value: 97 }]))
    run('collect.ts', ['check'], { ACTUALS_SHA: 'abc123', ACTUALS_DIR: 'parts' })
    expect(await read('actuals-check.json')).toMatchObject({ sha: 'abc123', job: 'check', tools: [{ tool: 'coverage', values: expect.arrayContaining([{ key: '/lines', value: 97 }]) }] })
  })

  it.each([
    ['the job', [], { ACTUALS_SHA: 'abc123', ACTUALS_DIR: 'parts' }],
    ['the commit', ['check'], { ACTUALS_DIR: 'parts' }],
    ['the folder', ['check'], { ACTUALS_SHA: 'abc123' }],
  ])('collect.ts fails without %s, writing nothing', (_, args, env) => {
    expect(() => run('collect.ts', args, env)).toThrow(/Usage: ACTUALS_SHA=<commit> ACTUALS_DIR=<folder> node scripts\/actuals\/collect.ts <job>/)
    expect(readJson(at('actuals-check.json'))).toBeUndefined()
  })

  it('coverage.ts reads the report it is given, and coverage/coverage-summary.json by default', async () => {
    await mkdir(at('coverage'))
    await writeFile(at('coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 91 } } }))
    await writeFile(at('other.json'), JSON.stringify({ total: { lines: { pct: 92 } } }))
    run('coverage.ts', [], { ACTUALS_DIR: 'parts' })
    expect((await read('parts/coverage.json')).values).toContainEqual({ key: '/lines', value: 91 })
    run('coverage.ts', ['other.json'], { ACTUALS_DIR: 'parts' })
    expect((await read('parts/coverage.json')).values).toContainEqual({ key: '/lines', value: 92 })
  })
})

describe('ActualsReporter', () => {
  const attachment = (name: string, body: object | undefined) => ({ name, contentType: 'application/json', body: body && Buffer.from(JSON.stringify(body)) })
  const result = (status: TestResult['status'], attachments: TestResult['attachments']) => ({ status, attachments }) as TestResult
  const test = {} as TestCase

  it('writes the values a test attached before failing its budget, for each tool its config names', async () => {
    vi.stubEnv('ACTUALS_DIR', at('parts'))
    const reporter = new ActualsReporter({ tools: ['requests', 'journeys', 'layoutShift'] })
    reporter.onTestEnd(test, result('failed', [attachment('requests', { size: 'phone', screen: 'downloads', counts: { '/qbt': 9 } })]))
    reporter.onTestEnd(test, result('passed', [attachment('journey requests', { size: 'phone', screen: 'tabs.1-search', counts: { '/qbt': 0 } })]))
    reporter.onTestEnd(test, result('failed', [attachment('layout shift', { size: 'phone', screen: 'title', total: 0.5 }), attachment('trace', undefined)]))
    reporter.onTestEnd(test, result('failed', [attachment('axe downloads/list', { spec: 'downloads', shot: 'list', violations: [], passes: 3 })]))
    reporter.onEnd()
    expect((await read('parts/requests.json')).values).toContainEqual({ key: '/phone/downloads/~1qbt', value: 9 })
    expect((await read('parts/requests.json')).health).toEqual({ screens: 1 })
    expect((await read('parts/journeys.json')).health).toEqual({ journeys: 1, moves: 1 })
    expect((await read('parts/layoutShift.json')).values).toContainEqual({ key: '/phone/title', value: 0.5 })
    // Not named by this config.
    expect(readJson(at('parts/accessibility.json'))).toBeUndefined()
    expect(reporter.printsToStdio()).toBe(false)
  })

  it('writes what axe read, the states and the passes', async () => {
    vi.stubEnv('ACTUALS_DIR', at('parts'))
    const reporter = new ActualsReporter({ tools: ['accessibility'] })
    reporter.onTestEnd(
      test,
      result('failed', [
        attachment('axe downloads/list', { spec: 'downloads', shot: 'list', violations: [{ id: 'region', nodes: [{}] }], passes: 3 }),
        // Another attachment with a body: a screenshot's, or one a test adds.
        { name: 'downloads-list-actual.png', contentType: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      ]),
    )
    reporter.onEnd()
    const part = await read('parts/accessibility.json')
    expect(part.values).toContainEqual({ key: '/downloads/list/region', value: 1 })
    expect(part.health).toEqual({ states: 1, passes: 3 })
  })

  it('writes a tool nothing attached for with its counters at 0, since its tests ran and measured nothing', async () => {
    vi.stubEnv('ACTUALS_DIR', at('parts'))
    const reporter = new ActualsReporter({ tools: ['requests'] })
    reporter.onEnd()
    expect((await read('parts/requests.json')).health).toEqual({ screens: 0 })
  })

  it('writes nothing without ACTUALS_DIR', () => {
    vi.stubEnv('ACTUALS_DIR', '')
    const reporter = new ActualsReporter({ tools: ['requests'] })
    reporter.onEnd()
    expect(readJson(at('parts/requests.json'))).toBeUndefined()
  })
})
