// Writing the actual values (docs/QUALITY.md → The actual values): each tool's part as it measures,
// into the folder CI names in ACTUALS_DIR, and the job's file collect.ts makes of them. The rules
// are in actuals.ts; this file only reads and writes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolActuals } from './actuals.ts'

/** checks.json, wherever the tool runs from. */
export const CHECKS = fileURLToPath(new URL('../../checks.json', import.meta.url))

/** Writes a tool's part into `dir` as `<tool>.json`, making the folder when it isn't there. */
export function writePart(dir: string, part: ToolActuals): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${part.tool}.json`), `${JSON.stringify(part)}\n`)
}

/** A JSON file's value, or undefined when it can't be read or parsed: a tool that can't read checks.json still writes what it measured. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}
