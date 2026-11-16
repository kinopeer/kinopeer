// Coverage's part of the actual values (docs/QUALITY.md → The actual values), a step of CI's `check`
// job after the tests whatever their outcome: Vitest writes its `json-summary` report before it
// judges the thresholds, so a run under them still has its numbers. Writes nothing without ACTUALS_DIR.
// `node scripts/actuals/coverage.ts coverage/coverage-summary.json`.
import { coverageActuals, type ToolActuals } from './actuals.ts'
import { CHECKS, readJson, writePart } from './write.ts'

/** Coverage's part from the report at `summary`, written into ACTUALS_DIR when it's set. */
export function main({ summary, checks = CHECKS }: { summary: string; checks?: string }, env: { ACTUALS_DIR?: string }): ToolActuals {
  const part = coverageActuals(readJson(summary), readJson(checks))
  if (env.ACTUALS_DIR) writePart(env.ACTUALS_DIR, part)
  return part
}

// Run as a script rather than imported.
if (import.meta.main) main({ summary: process.argv[2] ?? 'coverage/coverage-summary.json' }, process.env)
