// A Playwright reporter for the requests budget: collects the counts each test attached and prints
// them as one table, also into the job's summary in CI (docs/QUALITY.md → The requests budget).
import { appendFileSync } from 'node:fs'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { table, type Counts, type Opened } from '../../scripts/requests/budget.ts'

export default class RequestsSummary implements Reporter {
  private measured: (Opened & { counts: Counts })[] = []

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name === 'requests' && attachment.body) this.measured.push(JSON.parse(attachment.body.toString('utf8')))
    }
  }

  onEnd(): void {
    if (this.measured.length === 0) return
    const report = table(this.measured)
    console.log(`\n${report}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  }

  printsToStdio(): boolean {
    return false
  }
}
