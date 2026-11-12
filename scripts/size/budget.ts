// The size budget's rules: what kind each built file is, the budgets read from checks.json, and the
// verdict on the totals. Pure, with no Node APIs: size.ts reads dist/ and checks.json and hands them
// here (docs/QUALITY.md → The size budget).

export const KINDS = ['js', 'css', 'rest'] as const
export type Kind = (typeof KINDS)[number]

/** The most bytes each kind may take in all, from `budgets.size` in checks.json. */
export type Budgets = Record<Kind, number>

/** A built file: its path in dist/ and the bytes it counts for, gzipped or as is (`counted`). */
export type File = { path: string; size: number }

/** What the check found: whether it passes, and its report as Markdown. */
export type Verdict = { passed: boolean; report: string }

const LABELS: Record<Kind, string> = { js: 'JS, gzipped', css: 'CSS, gzipped', rest: 'Everything else, as is' }
const NAMES: Record<Kind, string> = { js: 'JS', css: 'CSS', rest: 'Everything else' }
/** How many of a kind's heaviest files a failure names. */
const HEAVIEST = 3
const TITLE = '## Build size'

/** The kind a built file counts under, by its extension. */
export function kindOf(path: string): Kind {
  if (/\.m?js$/.test(path)) return 'js'
  if (path.endsWith('.css')) return 'css'
  return 'rest'
}

/**
 * Whether a file counts gzipped: JS and CSS are text the server compresses, and their gzipped size is
 * what a phone downloads; fonts and icons are compressed already, so they count as they are.
 */
export const counted = (kind: Kind): 'gzipped' | 'as is' => (kind === 'rest' ? 'as is' : 'gzipped')

/** The budgets in checks.json's object, or what is wrong with them: each kind needs a whole number of bytes above 0. */
export function readBudgets(checks: unknown): Budgets | string[] {
  const at = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined)
  const size = at(at(checks, 'budgets'), 'size')
  const problems: string[] = []
  const budgets = {} as Budgets
  for (const kind of KINDS) {
    const budget = at(size, kind)
    if (typeof budget === 'number' && Number.isSafeInteger(budget) && budget > 0) budgets[kind] = budget
    else problems.push(`\`budgets.size.${kind}\` in checks.json is ${budget === undefined ? 'missing' : `not a whole number of bytes above 0: \`${JSON.stringify(budget)}\``}`)
  }
  return problems.length > 0 ? problems : budgets
}

const bytes = (count: number): string => `${count.toLocaleString('en-US')} B`

/** The built files against the budgets: each kind's total within its budget passes, and a build with no files fails. */
export function judge(files: File[], budgets: Budgets): Verdict {
  if (files.length === 0) return unchecked(['the build has no files: run `npm run build` first'])
  const rows = KINDS.map((kind) => {
    const own = files.filter((file) => kindOf(file.path) === kind).sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    return { kind, size: own.reduce((total, file) => total + file.size, 0), budget: budgets[kind], own }
  })
  const table = ['| Kind | Size | Budget | Left |', '| --- | ---: | ---: | ---: |', ...rows.map(({ kind, size, budget }) => `| ${LABELS[kind]} | ${bytes(size)} | ${bytes(budget)} | ${bytes(budget - size)} |`)]
  const over = rows.filter(({ size, budget }) => size > budget)
  const failures = over.map(({ kind, size, budget, own }) => {
    const heaviest = own.slice(0, HEAVIEST).map((file) => `\`${file.path}\` ${bytes(file.size)}`)
    return `**${NAMES[kind]} is over its budget by ${bytes(size - budget)}**: ${bytes(size)} ${counted(kind)} against ${bytes(budget)}. Its heaviest files: ${heaviest.join(', ')}.`
  })
  const advice =
    over.length === 0
      ? []
      : [
          'Find what grew: build `main` and this branch, each after `npm ci`, run `npm run size` on each and compare the files of that kind (a new dependency, an import that pulls in a whole library, an asset). ' +
            'Make it smaller or leave it out. Raising a budget is the owner\'s decision, not a way to get a PR through (docs/QUALITY.md → The size budget).',
        ]
  return { passed: over.length === 0, report: [TITLE, table.join('\n'), ...failures, ...advice].join('\n\n') }
}

/** A check that couldn't be made fails, and says why: a budget or a build it can't read is not a pass. */
export function unchecked(problems: string[]): Verdict {
  return { passed: false, report: [TITLE, `The size couldn't be checked:\n\n${problems.map((problem) => `- ${problem}`).join('\n')}`].join('\n\n') }
}
