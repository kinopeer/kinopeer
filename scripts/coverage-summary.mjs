// Prints the totals of a `json-summary` coverage report as a Markdown table, for CI's job summary:
// `node scripts/coverage-summary.mjs coverage/coverage-summary.json >> "$GITHUB_STEP_SUMMARY"`.
import { readFileSync } from 'node:fs'

const [path = 'coverage/coverage-summary.json'] = process.argv.slice(2)
const { total } = JSON.parse(readFileSync(path, 'utf8'))
const rows = ['lines', 'statements', 'functions', 'branches'].map(
  (kind) => `| ${kind[0].toUpperCase()}${kind.slice(1)} | ${total[kind].pct}% | ${total[kind].covered} / ${total[kind].total} |`,
)
console.log(['## Test coverage', '', '| | Covered | Of |', '| --- | ---: | ---: |', ...rows, '', 'The HTML report is in the `coverage` artifact.'].join('\n'))
