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
/** What a build lacks when it has no file of a kind, which every build of the app has. */
const NONE: Record<Kind, string> = { js: 'no JS file (`.js`, `.mjs`)', css: 'no CSS file', rest: 'no other file (`index.html`, the fonts, the icons)' }
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
 * Whether a file counts gzipped. JS and CSS are most of the text the server compresses: gzip at its
 * default level is a steady measure of them, though server/static.ts sends Brotli to a browser that
 * takes it and gzip only to one that doesn't. The rest counts as it is: the fonts and icons are
 * compressed already, and its few text files (index.html, the manifest, favicon.svg, version.json)
 * are small.
 */
export const counted = (kind: Kind): 'gzipped' | 'as is' => (kind === 'rest' ? 'as is' : 'gzipped')

/** The budgets in checks.json's object, or what is wrong with them: each kind needs a whole number of bytes above 0. */
export function readBudgets(checks: unknown): Budgets | string[] {
  // A list has no such keys, so it reads as missing too.
  const at = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined)
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

/**
 * The built files against the budgets: each kind's total within its budget passes. A build without a
 * file of some kind fails as one that couldn't be checked: it was cut short, or names its files in a
 * way `kindOf` doesn't read, rather than got light.
 */
export function judge(files: File[], budgets: Budgets): Verdict {
  const rows = KINDS.map((kind) => {
    const own = files.filter((file) => kindOf(file.path) === kind).sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    return { kind, size: own.reduce((total, file) => total + file.size, 0), budget: budgets[kind], own }
  })
  const missing = rows.filter(({ own }) => own.length === 0)
  if (missing.length > 0) return unchecked(missing.map(({ kind }) => `the build has ${NONE[kind]}, which every build of the app has: run \`npm run build\` again`))
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
