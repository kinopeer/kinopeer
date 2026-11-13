// A Playwright reporter for the speed budgets the browser measures: collects the numbers each test
// attached and prints them as tables, the screens' openings and the journeys' moves (docs/QUALITY.md
// → The requests budget) and the screens' layout shifts (docs/TESTING.md → The layout shift test),
// also into the job's summary in CI.
import { appendFileSync, readFileSync } from 'node:fs'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { readBudgets, table as layoutShiftTable, type Budgets, type Reading } from '../../scripts/layout-shift/budget.ts'
import { JOURNEYS, OPENINGS, table, type Counts, type Measure, type Opened } from '../../scripts/requests/budget.ts'

/** Each attachment's name, and what its counts are of: requests.perf.ts attaches `requests`, journeys.perf.ts `journey requests`. */
const ATTACHMENTS: [string, Measure][] = [
  ['requests', OPENINGS],
  ['journey requests', JOURNEYS],
]

export default class RequestsSummary implements Reporter {
  private measured = new Map<string, (Opened & { counts: Counts })[]>(ATTACHMENTS.map(([name]) => [name, []]))
  private readings: Reading[] = []

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (!attachment.body) continue
      const parsed = () => JSON.parse(attachment.body!.toString('utf8'))
      if (attachment.name === 'layout shift') this.readings.push(parsed())
      else this.measured.get(attachment.name)?.push(parsed())
    }
  }

  onEnd(): void {
    const tables = ATTACHMENTS.filter(([name]) => this.measured.get(name)!.length > 0).map(([name, measure]) => table(this.measured.get(name)!, measure))
    if (this.readings.length > 0) {
      const budgets = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))
      tables.push(layoutShiftTable(this.readings, Array.isArray(budgets) ? {} : (budgets as Budgets)))
    }
    if (tables.length === 0) return
    const report = tables.join('\n\n')
    console.log(`\n${report}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  }

  printsToStdio(): boolean {
    return false
  }
}
