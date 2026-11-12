// The size budget: `npm run size` after `npm run build`, and a step of CI's `check` job right after
// the build (docs/QUALITY.md → The size budget). It sums dist/'s files by kind (JS and CSS gzipped,
// the rest as they are), compares the sums with the budgets in checks.json and prints a table as
// Markdown, also into the job's summary in CI. It fails over a budget, and also when it can't read
// the build or a budget. The rules are in budget.ts; this file only reads.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { counted, judge, kindOf, readBudgets, unchecked, type Budgets, type File, type Verdict } from './budget.ts'

/** Every file under `dir`, with the bytes it counts for. Throws when `dir` can't be read. */
export function builtFiles(dir: string): File[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      const path = relative(dir, full)
      const content = readFileSync(full)
      // gzip's default level, the one server/static.ts sends JS and CSS with.
      return { path, size: counted(kindOf(path)) === 'gzipped' ? gzipSync(content).length : content.length }
    })
}

const why = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `--dist` and `--checks` from the command line: the build's folder and the budgets' file, dist/ and checks.json by default. */
export function options(args: string[]): { dist: string; checks: string } {
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`)
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback
  }
  return { dist: value('dist', 'dist'), checks: value('checks', 'checks.json') }
}

/** The verdict for the build against the budgets the arguments name. In CI it also appends the report to the job's summary. */
export function main(args: string[], env: { GITHUB_STEP_SUMMARY?: string }): Verdict {
  const { dist, checks } = options(args)
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
  const { passed, report } = main(process.argv, process.env)
  console.log(report)
  process.exitCode = passed ? 0 : 1
}
