// A Playwright reporter for the requests budget: collects the counts each test attached and prints
// them as tables, the screens' openings and the journeys' moves, also into the job's summary in CI
// (docs/QUALITY.md → The requests budget).
import { appendFileSync } from 'node:fs'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { JOURNEYS, OPENINGS, table, type Counts, type Measure, type Opened } from '../../scripts/requests/budget.ts'

/** Each attachment's name, and what its counts are of: requests.perf.ts attaches `requests`, journeys.perf.ts `journey requests`. */
const ATTACHMENTS: [string, Measure][] = [
  ['requests', OPENINGS],
  ['journey requests', JOURNEYS],
]

export default class RequestsSummary implements Reporter {
  private measured = new Map<string, (Opened & { counts: Counts })[]>(ATTACHMENTS.map(([name]) => [name, []]))

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.body) this.measured.get(attachment.name)?.push(JSON.parse(attachment.body.toString('utf8')))
    }
  }

  onEnd(): void {
    const tables = ATTACHMENTS.filter(([name]) => this.measured.get(name)!.length > 0).map(([name, measure]) => table(this.measured.get(name)!, measure))
    if (tables.length === 0) return
    const report = tables.join('\n\n')
    console.log(`\n${report}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  }

  printsToStdio(): boolean {
    return false
  }
}
