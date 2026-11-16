// A Playwright reporter that writes the actual values the browser tests measured (docs/QUALITY.md →
// The actual values) from what each test attached before its budget's assertion: requests.perf.ts
// and journeys.perf.ts the counts, layoutShift.perf.ts the layout shift, e2e/test.ts what axe read.
// So a test that fails its budget still gives its numbers. Each config names the tools its tests
// measure; it writes their parts into ACTUALS_DIR at the run's end, nothing without it, so it is
// loaded in every run and only CI sets the folder.
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { accessibilityActuals, journeysActuals, layoutShiftActuals, requestsActuals, type Counted, type Load, type Read, type Tool, type ToolActuals } from './actuals.ts'
import { CHECKS, readJson, writePart } from './write.ts'

/** The tools a browser test measures, by the attachment it reads them from (`axe ` and the state for accessibility). */
type BrowserTool = Extract<Tool, 'requests' | 'journeys' | 'layoutShift' | 'accessibility'>

const toolOf = (name: string): BrowserTool | undefined => {
  if (name === 'requests') return 'requests'
  if (name === 'journey requests') return 'journeys'
  if (name === 'layout shift') return 'layoutShift'
  if (name.startsWith('axe ')) return 'accessibility'
  return undefined
}

export default class ActualsReporter implements Reporter {
  private tools: BrowserTool[]
  private attached = new Map<BrowserTool, unknown[]>()

  constructor({ tools }: { tools: BrowserTool[] }) {
    this.tools = tools
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const { name, body } of result.attachments) {
      const tool = toolOf(name)
      if (!tool || !body) continue
      if (!this.attached.has(tool)) this.attached.set(tool, [])
      this.attached.get(tool)!.push(JSON.parse(body.toString('utf8')))
    }
  }

  onEnd(): void {
    const dir = process.env.ACTUALS_DIR
    if (!dir) return
    const checks = readJson(CHECKS)
    for (const tool of this.tools) writePart(dir, this.part(tool, checks))
  }

  private part(tool: BrowserTool, checks: unknown): ToolActuals {
    const attached = this.attached.get(tool) ?? []
    if (tool === 'requests') return requestsActuals(attached as Counted[], checks)
    if (tool === 'journeys') return journeysActuals(attached as Counted[], checks)
    if (tool === 'layoutShift') return layoutShiftActuals(attached as Load[], checks)
    return accessibilityActuals(attached as Read[], checks)
  }

  printsToStdio(): boolean {
    return false
  }
}
