// The last step of each measuring job in CI (docs/QUALITY.md → The actual values): puts the parts
// its tools wrote into ACTUALS_DIR into one file, `actuals-<job>.json`, which the job uploads as its
// `actuals-<job>` artifact whatever the job's outcome. A tool that wrote no part gets every value null.
// `node scripts/actuals/collect.ts <job>`, with the commit measured in ACTUALS_SHA.
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assemble, type Actuals } from './actuals.ts'
import { CHECKS, readJson } from './write.ts'

/** The parts in `dir`: every `.json` file in it, none when the folder isn't there (no tool got to write). */
function partsIn(dir: string): unknown[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith('.json')).sort().map((name) => readJson(join(dir, name)))
}

/** Writes the job's file to `out` from the parts in `dir`, and returns it. */
export function main({ job, sha, dir, out, checks = CHECKS }: { job: string; sha: string; dir: string; out: string; checks?: string }): Actuals {
  const actuals = assemble({ sha, job, parts: partsIn(dir), checks: readJson(checks) })
  writeFileSync(out, `${JSON.stringify(actuals, null, 2)}\n`)
  return actuals
}

// Run as a script rather than imported.
if (import.meta.main) {
  const [job] = process.argv.slice(2)
  const { ACTUALS_SHA: sha, ACTUALS_DIR: dir } = process.env
  if (!job || !sha || !dir) throw new Error('Usage: ACTUALS_SHA=<commit> ACTUALS_DIR=<folder> node scripts/actuals/collect.ts <job>')
  main({ job, sha, dir, out: `actuals-${job}.json` })
}
