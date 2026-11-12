// The size budget: `npm run size` after `npm run build`, and a step of CI's `performance` job right
// after the build (docs/QUALITY.md → The size budget). It sums dist/'s files by kind (JS and CSS gzipped,
// the rest as they are), compares the sums with the budgets in checks.json and prints a table as
// Markdown, also into the job's summary in CI. It fails over a budget, and also when it can't read
// the build or a budget. The rules are in budget.ts; this file only reads. It takes no arguments:
// the budgets come from checks.json alone, where the checks guard compares them with main's.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { counted, judge, kindOf, readBudgets, unchecked, type Budgets, type File, type Verdict } from './budget.ts'

/**
 * Every file under `dir`, with the bytes it counts for. Throws when `dir` can't be read, and on an
 * entry that is neither a file nor a folder (a symlink), which the server would still serve: what the
 * check can't count fails it rather than counting as nothing.
 */
export function builtFiles(dir: string): File[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      const path = relative(dir, full)
      if (!entry.isFile()) throw new Error(`\`${path}\` is neither a file nor a folder, which the check can't count`)
      const content = readFileSync(full)
      return { path, size: counted(kindOf(path)) === 'gzipped' ? gzipSync(content).length : content.length }
    })
}

// What reading a file throws: Node's file system and JSON.parse throw Errors.
const why = (error: unknown): string => (error as Error).message

/** The verdict for the build in `dist` against the budgets in `checks`. In CI it also appends the report to the job's summary. */
export function main({ dist, checks }: { dist: string; checks: string }, env: { GITHUB_STEP_SUMMARY?: string }): Verdict {
  const problems: string[] = []
  let files: File[] | undefined
  let budgets: Budgets | undefined
  try {
    files = builtFiles(dist)
  } catch (error) {
    problems.push(`the build in \`${dist}\` can't be read (run \`npm run build\` first): ${why(error)}`)
  }
  try {
    const read = readBudgets(JSON.parse(readFileSync(checks, 'utf8')))
    if (Array.isArray(read)) problems.push(...read)
    else budgets = read
  } catch (error) {
    problems.push(`\`${checks}\` can't be read as JSON: ${why(error)}`)
  }
  const verdict = files && budgets ? judge(files, budgets) : unchecked(problems)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${verdict.report}\n`)
  return verdict
}

// Run as a script rather than imported.
if (import.meta.main) {
  const { passed, report } = main({ dist: 'dist', checks: 'checks.json' }, process.env)
  console.log(report)
  process.exitCode = passed ? 0 : 1
}
