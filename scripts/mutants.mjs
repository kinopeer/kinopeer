// Runs Stryker over the lines this branch changes and prints what survived, as Markdown:
// `npm run test:mutants`. Stryker's progress goes to stderr, the report to stdout, which CI posts on
// the PR. Survivors don't fail the run, because some are mutants no test can tell from the original;
// the PR says what each one is (docs/TESTING.md → A test that can fail).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const BASE = process.env.MUTANTS_BASE || 'origin/main'
const REPORT = 'reports/mutants.json'
const SOURCE = /\.tsx?$/
const NOT_PRODUCTION = /\.test\.tsx?$|\/test\/|\.d\.ts$|^src\/test-setup\.ts$/

function git(...args) {
  const { status, stdout, stderr } = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${stderr}`)
  return stdout
}

// `file:first-last` for each hunk the branch added or changed. A hunk that only deletes has no lines
// on this side, and so nothing to mutate.
function changedRanges() {
  const ranges = []
  let file
  for (const line of git('diff', '-U0', `${BASE}...HEAD`, '--', 'src', 'server', 'tmdb-proxy').split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice('+++ b/'.length)
      file = SOURCE.test(path) && !NOT_PRODUCTION.test(path) ? path : undefined
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk && file) {
      const [first, count] = [Number(hunk[1]), Number(hunk[2] ?? 1)]
      if (count > 0) ranges.push(`${file}:${first}-${first + count - 1}`)
    }
  }
  return ranges
}

function survivors({ files }) {
  return Object.entries(files).flatMap(([file, { source, mutants }]) =>
    mutants
      .filter(({ status }) => status === 'Survived' || status === 'NoCoverage')
      .map(({ location: { start, end }, mutatorName, replacement, status }) => {
        const first = source.split('\n')[start.line - 1]
        const original = first.slice(start.column - 1, start.line === end.line ? end.column - 1 : undefined).trim()
        const noTest = status === 'NoCoverage' ? ', no test runs it' : ''
        return `- \`${file}:${start.line}\` ${mutatorName}${noTest}: \`${original}\` → \`${replacement ?? ''}\``.replaceAll('\n', ' ')
      }),
  )
}

const commit = git('rev-parse', '--short', 'HEAD').trim()
const ranges = changedRanges()
if (ranges.length === 0) {
  console.log(`**Mutants at ${commit}:** nothing to mutate, no production lines changed since ${BASE}.`)
  process.exit(0)
}

rmSync(REPORT, { force: true })
const { status } = spawnSync('npx', ['stryker', 'run', '--mutate', ranges.join(',')], { stdio: ['ignore', 2, 2] })
if (status !== 0) process.exit(status ?? 1)

const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { files: {} }
const left = survivors(report)
const total = Object.values(report.files).reduce((sum, { mutants }) => sum + mutants.length, 0)
console.log(`**Mutants at ${commit}:** ${left.length} survived of ${total}, over ${ranges.length} changed ranges.`)
if (left.length > 0) console.log(`\n${left.join('\n')}`)
