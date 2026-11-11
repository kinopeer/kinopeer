import { describe, expect, it } from 'vitest'
import { compareChecks, compareLint, compareWorkflow, findings, readsWhole, report, scanAdded, workflowSteps, type Finding } from './signs.ts'

const json = (value: unknown) => JSON.stringify(value)
/** What each finding calls for and says, without its file. */
const said = (found: Finding[]) => found.map(({ needs, what }) => `${needs}: ${what}`)

describe('compareChecks', () => {
  const checks = {
    coverage: { include: ['src/**'], exclude: ['**/*.test.ts'], thresholds: { lines: 96, branches: 93 } },
    mutants: { folders: ['src', 'server'], notProduction: ['/test/'], excludedMutations: ['StringLiteral'] },
  }
  const withCoverage = (coverage: object) => json({ ...checks, coverage: { ...checks.coverage, ...coverage } })
  const withMutants = (mutants: object) => json({ ...checks, mutants: { ...checks.mutants, ...mutants } })

  it('finds nothing in a file that says the same in another layout', () => {
    expect(compareChecks(json(checks), JSON.stringify(checks, null, 2))).toEqual([])
  })

  it.each([
    ['a threshold lowered', withCoverage({ thresholds: { lines: 95, branches: 93 } }), ['owner: the threshold `coverage.thresholds.lines` is lowered: `96` → `95`']],
    ['a threshold removed', withCoverage({ thresholds: { lines: 96 } }), ['owner: the threshold `coverage.thresholds.branches` is lowered: `93` → nothing']],
    ['a threshold that is no longer a number', withCoverage({ thresholds: { lines: '97', branches: 93 } }), ['owner: the threshold `coverage.thresholds.lines` is lowered: `96` → `"97"`']],
    ['a path added to what coverage leaves out', withCoverage({ exclude: ['**/*.test.ts', 'src/api/**'] }), ['owner: `coverage.exclude` leaves out more: `"src/api/**"` is added']],
    ['a path removed from what coverage measures', withCoverage({ include: [] }), ['owner: `coverage.include` takes in less: `"src/**"` is removed']],
    ['a mutator added to those left out', withMutants({ excludedMutations: ['StringLiteral', 'BooleanLiteral'] }), ['owner: `mutants.excludedMutations` leaves out more: `"BooleanLiteral"` is added']],
    ['a pattern added to what is not mutated', withMutants({ notProduction: ['/test/', '^server/'] }), ['owner: `mutants.notProduction` leaves out more: `"^server/"` is added']],
    ['a folder removed from those mutated', withMutants({ folders: ['src'] }), ['owner: `mutants.folders` takes in less: `"server"` is removed']],
    [
      'an entry rewritten, as one added and one removed',
      withCoverage({ exclude: ['**/*.spec.ts'] }),
      ['owner: `coverage.exclude` leaves out more: `"**/*.spec.ts"` is added', 'review: `coverage.exclude` changed: `"**/*.test.ts"` is removed'],
    ],
  ])('sends %s to the owner', (_name, head, expected) => {
    expect(said(compareChecks(json(checks), head))).toEqual(expected)
  })

  it.each([
    ['a threshold raised', withCoverage({ thresholds: { lines: 97, branches: 93 } }), ['review: the threshold `coverage.thresholds.lines` changed: `96` → `97`']],
    ['a new threshold', withCoverage({ thresholds: { lines: 96, branches: 93, functions: 95 } }), ['review: the threshold `coverage.thresholds.functions` changed: nothing → `95`']],
    ['a path coverage no longer leaves out', withCoverage({ exclude: [] }), ['review: `coverage.exclude` changed: `"**/*.test.ts"` is removed']],
    ['a folder added to those mutated', withMutants({ folders: ['src', 'server', 'scripts'] }), ['review: `mutants.folders` changed: `"scripts"` is added']],
    ['a key the guard has no rule for', json({ ...checks, budgets: { bundle: 300 } }), ['review: `budgets.bundle` changed: nothing → `300`']],
    ['a key set to null', json({ ...checks, budgets: null }), ['review: `budgets` changed: nothing → `null`']],
  ])('sends %s to a second review', (_name, head, expected) => {
    expect(said(compareChecks(json(checks), head))).toEqual(expected)
  })

  it('sends the file removed to the owner', () => {
    expect(said(compareChecks(json(checks), undefined))).toEqual(['owner: the file with the thresholds and the exclusion lists is removed'])
  })

  it.each([
    ['broken JSON', '{ "coverage": '],
    ['JSON that is not an object', '[96]'],
  ])('sends %s to the owner rather than passing it', (_name, head) => {
    expect(said(compareChecks(json(checks), head))).toEqual(["owner: the guard can't read the file as a JSON object, so it can't compare it"])
  })

  it('finds nothing in a file main does not have yet', () => {
    expect(compareChecks(undefined, json(checks))).toEqual([])
  })

  it("sends a file that replaces one it can't read on main to a second review", () => {
    expect(said(compareChecks('{', json(checks)))).toEqual(["review: the guard can't read main's copy as a JSON object, so it has nothing to compare this one with"])
  })
})

describe('compareLint', () => {
  const config = {
    plugins: ['react', 'vitest'],
    rules: { 'react/rules-of-hooks': 'error', 'react/only-export-components': ['warn', { allowConstantExport: true }], 'vitest/valid-expect': ['error', { maxArgs: 2 }], 'vitest/require-to-throw-message': 'off' },
    overrides: [{ files: ['e2e/smoke/*.smoke.ts'], rules: { 'no-restricted-imports': ['error', { paths: ['@playwright/test'] }] } }],
  }
  const withRules = (rules: object) => json({ ...config, rules: { ...config.rules, ...rules } })
  const without = (name: string) => json({ ...config, rules: Object.fromEntries(Object.entries(config.rules).filter(([rule]) => rule !== name)) })

  it('finds nothing in a config that says the same in another layout', () => {
    expect(compareLint(json(config), JSON.stringify(config, null, 2))).toEqual([])
  })

  it.each([
    ['a rule turned off', withRules({ 'react/rules-of-hooks': 'off' }), ['owner: the lint rule `react/rules-of-hooks` is turned off: `"error"` → `"off"`']],
    ['a rule downgraded', withRules({ 'react/rules-of-hooks': 'warn' }), ['owner: the lint rule `react/rules-of-hooks` is downgraded: `"error"` → `"warn"`']],
    ['a rule with options downgraded', withRules({ 'vitest/valid-expect': ['warn', { maxArgs: 2 }] }), ['owner: the lint rule `vitest/valid-expect` is downgraded: `["error",{"maxArgs":2}]` → `["warn",{"maxArgs":2}]`']],
    ['a rule turned off by its number', withRules({ 'react/rules-of-hooks': 0 }), ['owner: the lint rule `react/rules-of-hooks` is turned off: `"error"` → `0`']],
    ["a rule turned off by oxlint's own word", withRules({ 'react/rules-of-hooks': 'allow' }), ['owner: the lint rule `react/rules-of-hooks` is turned off: `"error"` → `"allow"`']],
    ['a rule downgraded by its number', withRules({ 'react/rules-of-hooks': 1 }), ['owner: the lint rule `react/rules-of-hooks` is downgraded: `"error"` → `1`']],
    ["a rule written with oxlint's own word downgraded", [withRules({ 'no-console': 'deny' }), withRules({ 'no-console': 'warn' })], ['owner: the lint rule `no-console` is downgraded: `"deny"` → `"warn"`']],
    ['a rule written with its number downgraded', [withRules({ 'no-console': 2 }), withRules({ 'no-console': 'warn' })], ['owner: the lint rule `no-console` is downgraded: `2` → `"warn"`']],
    ["a rule whose severity on main it can't read, now a warning", [withRules({ 'no-console': 'maybe' }), withRules({ 'no-console': 'warn' })], ['owner: the lint rule `no-console` is downgraded: `"maybe"` → `"warn"`']],
    ['a rule removed', without('react/rules-of-hooks'), ['owner: the lint rule `react/rules-of-hooks` is removed']],
    ['a rule on by default turned off', withRules({ 'no-debugger': 'off' }), ['owner: the lint rule `no-debugger` is turned off']],
    ['a severity it does not know', withRules({ 'react/rules-of-hooks': 'maybe' }), ['owner: the lint rule `react/rules-of-hooks` has a severity the guard can\'t read: `"maybe"`']],
    ['a plugin removed', json({ ...config, plugins: ['react'] }), ['owner: the lint plugin "vitest" is removed, and its rules with it']],
    ['a path the linter skips', json({ ...config, ignorePatterns: ['e2e/**'] }), ['owner: the linter skips more: "e2e/**" is added to `ignorePatterns`']],
    [
      'one more path the linter skips',
      [json({ ...config, ignorePatterns: ['dist/**'] }), json({ ...config, ignorePatterns: ['dist/**', 'e2e/**'] })],
      ['owner: the linter skips more: "e2e/**" is added to `ignorePatterns`'],
    ],
    [
      'a new override that turns a rule off for some files',
      json({ ...config, overrides: [...config.overrides, { files: ['src/legacy/**'], rules: { 'react/rules-of-hooks': 'off' } }] }),
      ['owner: the lint rule `react/rules-of-hooks` for ["src/legacy/**"] is turned off: `"error"` → `"off"`'],
    ],
    ['an override removed', json({ ...config, overrides: [] }), ['owner: the lint rule `no-restricted-imports` for ["e2e/smoke/*.smoke.ts"] is removed']],
  ])('sends %s to the owner', (_name, change, expected) => {
    // A pair is main's config and the branch's; a single one is the branch's against `config`.
    const [base, head] = Array.isArray(change) ? change : [json(config), change]
    expect(said(compareLint(base, head))).toEqual(expected)
  })

  it.each([
    ['a rule with other options', withRules({ 'vitest/valid-expect': ['error', { maxArgs: 3 }] }), ['review: the lint rule `vitest/valid-expect` has other options: `["error",{"maxArgs":2}]` → `["error",{"maxArgs":3}]`']],
    ['a new rule that only warns', withRules({ 'no-console': 'warn' }), ["review: the lint rule `no-console` is added as `warn`, which doesn't fail the run"]],
    ['a key it has no rule for', json({ ...config, categories: { correctness: 'off' } }), ['review: `categories` changed: nothing → `{"correctness":"off"}`']],
    ["a rule whose severity on main it can't read, now failing the run", [withRules({ 'no-console': 'maybe' }), withRules({ 'no-console': 'error' })], ['review: the lint rule `no-console` has other options: `"maybe"` → `"error"`']],
  ])('sends %s to a second review', (_name, change, expected) => {
    const [base, head] = Array.isArray(change) ? change : [json(config), change]
    expect(said(compareLint(base, head))).toEqual(expected)
  })

  it.each([
    ['a rule made stricter', withRules({ 'react/only-export-components': ['error', { allowConstantExport: true }] })],
    ['a rule that only warned made to fail the run by its number', withRules({ 'react/only-export-components': [2, { allowConstantExport: true }] })],
    ["a rule that only warned made to fail the run by oxlint's own word", withRules({ 'react/only-export-components': 'deny' })],
    ['a rule written the other way at the same severity and options', withRules({ 'vitest/require-to-throw-message': 'off' })],
    ['an override that is not an object', json({ ...config, overrides: [...config.overrides, 'e2e'] })],
    ['a new rule that fails the run', withRules({ 'no-console': 'error' })],
    ['a rule that was off removed', without('vitest/require-to-throw-message')],
    ['a plugin added', json({ ...config, plugins: [...config.plugins, 'import'] })],
    ['an override that repeats the top-level rule', json({ ...config, overrides: [...config.overrides, { files: ['src/**'], rules: { 'react/rules-of-hooks': 'error' } }] })],
  ])('finds nothing in %s', (_name, head) => {
    expect(compareLint(json(config), head)).toEqual([])
  })

  it('sends the config removed and a config it cannot read to the owner', () => {
    expect(said(compareLint(json(config), undefined))).toEqual(["owner: the linter's config is removed"])
    expect(said(compareLint(json(config), '{'))).toEqual(["owner: the guard can't read the file as a JSON object, so it can't compare it"])
  })

  it('finds nothing in a config main does not have yet', () => {
    expect(compareLint(undefined, json(config))).toEqual([])
  })
})

const WORKFLOW = `
jobs:
  check:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run:   npm ci  
      - run: npm run lint
      - name: Dry run: nothing is uploaded
        run: >-
          echo
          dry
      - name: Add the totals
        if: always()
        run: |
          # A comment, which is not a command.
          if [ -f coverage.json ]; then

            node summary.mjs
          fi
        shell: bash
      - name: Upload
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: coverage
  docker:
    steps:
      - run: npm ci
`

describe('workflowSteps', () => {
  it('reads each step as the action or the command it runs, a block whole and without its comments', () => {
    expect(workflowSteps(WORKFLOW)).toEqual([
      'uses: actions/checkout',
      'run: npm ci',
      'run: npm run lint',
      'run: echo ; dry',
      'run: if [ -f coverage.json ]; then ; node summary.mjs ; fi',
      'uses: actions/upload-artifact',
      'run: npm ci',
    ])
  })
})

describe('compareWorkflow', () => {
  const file = '.github/workflows/ci.yml'

  it('sends a removed step to the owner', () => {
    expect(said(compareWorkflow(file, WORKFLOW, WORKFLOW.replace('      - run: npm run lint\n', '')))).toEqual(['owner: a CI step is removed: `run: npm run lint`'])
  })

  it('reads a block that ends the file', () => {
    expect(workflowSteps('      - run: |\n          npm ci\n          npm test')).toEqual(['run: npm ci ; npm test'])
  })

  it('sends one of two steps alike removed to the owner', () => {
    const head = WORKFLOW.replace('  docker:\n    steps:\n      - run: npm ci\n', '  docker:\n    steps: []\n')
    expect(said(compareWorkflow(file, WORKFLOW, head))).toEqual(['owner: a CI step is removed: `run: npm ci`'])
  })

  it('sends an edited command to a second review', () => {
    expect(said(compareWorkflow(file, WORKFLOW, WORKFLOW.replace('npm run lint', 'npm run lint -- --quiet')))).toEqual(['review: a CI step changed, it was: `run: npm run lint`'])
  })

  it('sends a line changed inside a block to a second review', () => {
    expect(said(compareWorkflow(file, WORKFLOW, WORKFLOW.replace('node summary.mjs', 'true')))).toEqual(['review: a CI step changed, it was: `run: if [ -f coverage.json ]; then ; node summary.mjs ; fi`'])
  })

  it.each([
    ['an action bumped', WORKFLOW.replace('3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', '0000000000000000000000000000000000000000 # v8.0.0')],
    ['a step added', WORKFLOW.replace('      - run: npm run lint\n', '      - run: npm run lint\n      - run: npm run typecheck\n')],
    ['steps in another order', WORKFLOW.replace('      - run: npm ci\n      - run: npm run lint\n', '      - run: npm run lint\n      - run: npm ci\n')],
    ['a comment changed', WORKFLOW.replace('# A comment, which is not a command.', '# Another comment.')],
  ])('finds nothing in %s', (_name, head) => {
    expect(compareWorkflow(file, WORKFLOW, head)).toEqual([])
  })

  it('cuts a command of more than 120 characters short in what it says', () => {
    const step = (length: number) => `      - run: ${'x'.repeat(length - 'run: '.length)}\n`
    const what = (length: number) => compareWorkflow(file, WORKFLOW + step(length), WORKFLOW)[0].what
    expect(what(120)).toBe(`a CI step is removed: \`run: ${'x'.repeat(115)}\``)
    expect(what(121)).toBe(`a CI step is removed: \`run: ${'x'.repeat(112)}…\``)
  })

  it('sends a removed workflow to the owner and finds nothing in a new one', () => {
    expect(said(compareWorkflow(file, WORKFLOW, undefined))).toEqual(['owner: the workflow is removed, and its steps with it'])
    expect(compareWorkflow(file, undefined, WORKFLOW)).toEqual([])
  })
})

describe('scanAdded', () => {
  const lines = (...texts: string[]) => texts.map((text, index) => ({ line: index + 10, text }))

  it.each([
    ['playwright.config.ts', '  retries: process.env.CI ? 2 : 0,'],
    ['playwright.smoke.config.ts', '  retries: 1,'],
    ['e2e/search.spec.ts', '  test.describe.configure({ retries: 1 })'],
    ['e2e/smoke/tabs.smoke.ts', '  test.describe.configure({ retries: 10 })'],
    ['package.json', '    "retries": 2,'],
    ['vite.config.ts', '      retry: 3,'],
    ['vite.config.ts', '      test: {retry:3},'],
    ['vite.config.ts', '      retry: process.env.CI ? 2 : 0,'],
    ['vite.config.ts', '      retry: { count: 2 },'],
    ['src/screens/SearchScreen.test.tsx', "  it('finds a title', { retry: 2 }, async () => {"],
    ['server/tmdb.test.ts', "  it('passes the answer on', { 'retry': 2 }, async () => {"],
    ['package.json', '    "test:smoke": "playwright test --retries=2",'],
    ['.github/workflows/ci.yml', '      - run: npx vitest run --retry 2'],
    ['scripts/test-visual.sh', 'npx playwright test --retries 2'],
    ['stryker.config.mjs', '  vitest: { retries: 2 },'],
  ])('sends test retries added to %s to the owner: %s', (file, text) => {
    expect(scanAdded(file, lines(text))).toEqual([{ needs: 'owner', file, line: 10, what: `test retries appeared: \`${text.trim()}\`` }])
  })

  it.each([
    ['e2e/search.spec.ts', "  await expect(page).toHaveScreenshot('search.png', { maxDiffPixels: 100 })"],
    ['playwright.config.ts', '    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },'],
    ['playwright.config.ts', '    toHaveScreenshot: { threshold: 0.3 },'],
    ['playwright.readme.config.ts', "    toHaveScreenshot: { 'threshold': 0.3 },"],
  ])('sends a screenshot tolerance added to %s to the owner: %s', (file, text) => {
    expect(scanAdded(file, lines(text))).toEqual([{ needs: 'owner', file, line: 10, what: `a screenshot tolerance appeared: \`${text.trim()}\`` }])
  })

  it.each([
    ['no retries', 'playwright.config.ts', '  retries: 0,'],
    ['no retries, written tight', 'playwright.config.ts', '  retries:0,'],
    ["the app's own retries", 'src/api/tmdb/client.ts', '  const options = { retries: 3 }'],
    ["the app's own retries in a file named like a test", 'src/api/tmdb/client.test.tsx.ts', '  const options = { retries: 3 }'],
    ["the app's own retries in a folder named like the tests'", 'src/e2e/client.ts', '  const options = { retries: 3 }'],
    ['a retry the app offers, in a test', 'src/screens/ReleasesBlock.test.tsx', '    retry: vi.fn(),'],
    ['a retry the app offers, in a type', 'e2e/app.ts', '  retry: () => void'],
    ['a test about retrying', 'src/api/tmdb/client.test.ts', "  it('retries after the time TMDB names', async () => {"],
    ['a word that only starts like one', 'vite.config.ts', '  retriesLeft: 2, retryAfter: 3,'],
    ['a flag that only starts like one', 'package.json', '    "start": "node server/main.ts --retrying",'],
    ['a doc in the root', 'CLAUDE.md', '`retries: 2` would hide a race'],
    ['a doc in a folder', 'docs/TESTING.md', 'retries: 2 would hide a race'],
    ['the coverage thresholds', 'vite.config.ts', '        thresholds: { lines: 96 },'],
    ['a threshold of the app', 'src/components/Sheet/sheetDrag.test.ts', '  expect(shouldClose({ threshold: 120 })).toBe(true)'],
    ['a threshold in a config that takes no screenshots', 'vite.config.ts', '        threshold: 0.3,'],
    ['a tolerance in a folder named like a Playwright config', 'playwright/notes.ts', '  maxDiffPixels: 100,'],
    ['a word that only ends like a threshold', 'e2e/app.ts', '  dragthreshold: 0.3,'],
  ])('finds nothing in %s', (_name, file, text) => {
    expect(scanAdded(file, lines(text))).toEqual([])
  })

  it('names the line of each match', () => {
    expect(scanAdded('playwright.config.ts', lines('  use: {},', '  retries: 2,')).map(({ line }) => line)).toEqual([11])
  })
})

describe('findings', () => {
  it.each(['scripts/guard/signs.ts', 'scripts/guard/guard.test.ts', '.github/workflows/guard.yml'])('sends a change to the guard itself to the owner: %s', (path) => {
    // With a line that would be a finding of its own anywhere else: the guard's files hold the patterns as text.
    expect(findings([{ path, base: 'jobs: {}', head: 'jobs: {}', added: [{ line: 1, text: '  retries: 2,' }] }])).toEqual([{ needs: 'owner', file: path, what: 'the checks guard itself changed' }])
  })

  it.each(['tmdb-proxy/scripts/guard/signs.ts', 'scripts/guardian.ts', 'docs/.github/workflows/guard.yml', '.github/workflows/guard.yml.md'])("doesn't take %s for the guard", (path) => {
    expect(findings([{ path, added: [] }])).toEqual([])
  })

  it('reads each file by its own rules and a workflow by both the steps and the lines', () => {
    const found = findings([
      { path: 'checks.json', base: '{"coverage":{"thresholds":{"lines":96}}}', head: '{"coverage":{"thresholds":{"lines":90}}}', added: [] },
      { path: '.oxlintrc.json', base: '{"rules":{"no-console":"error"}}', head: '{"rules":{}}', added: [] },
      { path: '.github/workflows/ci.yml', base: '      - run: npm test\n', head: '      - run: npm test -- --retry=2\n', added: [{ line: 1, text: '      - run: npm test -- --retry=2' }] },
      { path: 'src/App.tsx', added: [{ line: 1, text: 'export const retries = 2' }] },
    ])
    expect(found.map(({ needs, file }) => `${needs} ${file}`)).toEqual(['owner checks.json', 'owner .oxlintrc.json', 'review .github/workflows/ci.yml', 'owner .github/workflows/ci.yml'])
  })
})

describe('readsWhole', () => {
  it.each(['checks.json', '.oxlintrc.json', '.github/workflows/ci.yml', '.github/workflows/build.yaml'])('reads %s whole', (path) => {
    expect(readsWhole(path)).toBe(true)
  })

  it.each(['src/App.tsx', 'tmdb-proxy/checks.json', '.github/dependabot.yml', '.github/workflows/README.md', 'tmdb-proxy/.github/workflows/ci.yml', '.github/workflows/drafts/ci.yml', '.github/workflows/yml'])('reads only the added lines of %s', (path) => {
    expect(readsWhole(path)).toBe(false)
  })
})

describe('report', () => {
  const at = { head: 'abc1234', base: 'def5678' }

  it('says so when nothing is found', () => {
    expect(report([], at)).toBe('<!-- checks-guard -->\n**Checks guard at abc1234**, against `main` at def5678.\n\nNo weakening of the checks and no change to existing ones.')
  })

  it("lists what goes to the owner and what goes to a second review apart, each with its file and line", () => {
    const text = report(
      [
        { needs: 'review', file: 'checks.json', what: 'the threshold `coverage.thresholds.lines` changed: `96` → `97`' },
        { needs: 'owner', file: 'playwright.config.ts', line: 16, what: 'test retries appeared: `retries: 2,`' },
      ],
      at,
    )
    expect(text.split('\n')).toEqual([
      '<!-- checks-guard -->',
      '**Checks guard at abc1234**, against `main` at def5678.',
      '',
      '**For the owner: 1 to approve, each with a reason.** A weakening of the checks, or a change to the guard itself.',
      '',
      '- `playwright.config.ts:16`: test retries appeared: `retries: 2,`',
      '',
      "**For a second review: 1.** Changes to existing checks, which a script can't judge.",
      '',
      '- `checks.json`: the threshold `coverage.thresholds.lines` changed: `96` → `97`',
    ])
  })
})
