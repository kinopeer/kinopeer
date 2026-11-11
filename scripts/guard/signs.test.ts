import { describe, expect, it } from 'vitest'
import { commands, compareChecks, compareLint, compareScripts, compareWorkflows, findings, readsWhole, report, scanAdded, workflowSteps, type Finding } from './signs.ts'

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
    [
      'an exclusion list that is no longer a list',
      withCoverage({ exclude: 'src/**' }),
      ['owner: `coverage.exclude` is no longer a list the guard can read: `["**/*.test.ts"]` → `"src/**"`'],
    ],
    ['a list of what is checked that is gone', withMutants({ folders: undefined }), ['owner: `mutants.folders` is no longer a list the guard can read: `["src","server"]` → nothing']],
    [
      'a list replaced by an object',
      withCoverage({ include: { app: ['src/**'] } }),
      ['owner: `coverage.include` is no longer a list the guard can read: `["src/**"]` → nothing', 'review: `coverage.include.app` changed: nothing → `["src/**"]`'],
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
  /** main's config and the branch's: a pair as it is, a single one as the branch's against `config`. */
  const pair = (change: string | string[]): string[] => (Array.isArray(change) ? change : [json(config), change])
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
    const [base, head] = pair(change)
    expect(said(compareLint(base, head))).toEqual(expected)
  })

  it.each([
    ['a rule with other options', withRules({ 'vitest/valid-expect': ['error', { maxArgs: 3 }] }), ['review: the lint rule `vitest/valid-expect` has other options: `["error",{"maxArgs":2}]` → `["error",{"maxArgs":3}]`']],
    ['a new rule that only warns', withRules({ 'no-console': 'warn' }), ["review: the lint rule `no-console` is added as `warn`, which doesn't fail the run"]],
    ['a key it has no rule for', json({ ...config, categories: { correctness: 'off' } }), ['review: `categories` changed: nothing → `{"correctness":"off"}`']],
    [
      "a rule whose severity on main it can't read, now failing the run",
      [withRules({ 'no-console': 'maybe' }), withRules({ 'no-console': 'error' })],
      ['review: the lint rule `no-console` had a severity on main the guard can\'t read: `"maybe"` → `"error"`'],
    ],
    [
      'a rule made stricter with other options',
      withRules({ 'react/only-export-components': ['error', { allowConstantExport: false }] }),
      ['review: the lint rule `react/only-export-components` has other options: `["warn",{"allowConstantExport":true}]` → `["error",{"allowConstantExport":false}]`'],
    ],
    ['a rule that gained options at its severity', withRules({ 'react/rules-of-hooks': ['error', { additionalHooks: 'useX' }] }), ['review: the lint rule `react/rules-of-hooks` has other options: `"error"` → `["error",{"additionalHooks":"useX"}]`']],
  ])('sends %s to a second review', (_name, change, expected) => {
    const [base, head] = pair(change)
    expect(said(compareLint(base, head))).toEqual(expected)
  })

  it.each([
    ['a rule made stricter', withRules({ 'react/only-export-components': ['error', { allowConstantExport: true }] })],
    ['a rule that only warned made to fail the run by its number', withRules({ 'react/only-export-components': [2, { allowConstantExport: true }] })],
    ["a rule that only warned made to fail the run by oxlint's own word", withRules({ 'react/only-export-components': ['deny', { allowConstantExport: true }] })],
    ['a rule written the other way at the same severity', withRules({ 'react/rules-of-hooks': 2 })],
    ['a rule written the other way at the same severity and options', withRules({ 'vitest/valid-expect': ['deny', { maxArgs: 2 }] })],
    ['an override that is not an object', json({ ...config, overrides: [...config.overrides, 'e2e'] })],
    ['a new rule that fails the run', withRules({ 'no-console': 'error' })],
    ['a rule that was off removed', without('vitest/require-to-throw-message')],
    ['a plugin added', json({ ...config, plugins: [...config.plugins, 'import'] })],
    ['an override that repeats the top-level rule', json({ ...config, overrides: [...config.overrides, { files: ['src/**'], rules: { 'react/rules-of-hooks': 'error' } }] })],
    ["a rule left as it was, with a severity it can't read", [withRules({ 'no-console': 'maybe' }), withRules({ 'no-console': 'maybe' })]],
  ])('finds nothing in %s', (_name, change) => {
    const [base, head] = pair(change)
    expect(compareLint(base, head)).toEqual([])
  })

  it('sends the config removed and a config it cannot read to the owner', () => {
    expect(said(compareLint(json(config), undefined))).toEqual(["owner: the linter's config is removed"])
    expect(said(compareLint(json(config), '{'))).toEqual(["owner: the guard can't read the file as a JSON object, so it can't compare it"])
  })

  it('finds nothing in a config main does not have yet', () => {
    expect(compareLint(undefined, json(config))).toEqual([])
  })
})

describe('compareScripts', () => {
  const manifest = { name: 'kinopeer', scripts: { lint: 'oxlint', test: 'vitest run' }, dependencies: { react: '^19.3.1' } }
  const withScripts = (scripts: object) => json({ ...manifest, scripts })

  it('sends a removed script to the owner', () => {
    expect(said(compareScripts(json(manifest), withScripts({ test: 'vitest run' })))).toEqual(['owner: the npm script `lint` is removed: `"oxlint"`'])
  })

  it('sends a changed script to a second review', () => {
    expect(said(compareScripts(json(manifest), withScripts({ lint: 'oxlint --quiet', test: 'vitest run' })))).toEqual(['review: the npm script `lint` changed: `"oxlint"` → `"oxlint --quiet"`'])
  })

  it('sends every script to the owner when the scripts are gone', () => {
    expect(said(compareScripts(json(manifest), json({ name: 'kinopeer' })))).toEqual(['owner: the npm script `lint` is removed: `"oxlint"`', 'owner: the npm script `test` is removed: `"vitest run"`'])
  })

  it.each([
    ['a script added', withScripts({ ...manifest.scripts, guard: 'node scripts/guard/guard.ts' })],
    ['a dependency bumped', json({ ...manifest, dependencies: { react: '^20.0.0' } })],
    ['the same in another layout', JSON.stringify(manifest, null, 2)],
  ])('finds nothing in %s', (_name, head) => {
    expect(compareScripts(json(manifest), head)).toEqual([])
  })

  it("sends a package.json it can't read to the owner", () => {
    expect(said(compareScripts(json(manifest), '{'))).toEqual(["owner: the guard can't read the file as a JSON object, so it can't compare it"])
  })

  it('finds nothing in a package.json only one side has', () => {
    expect(compareScripts(undefined, json(manifest))).toEqual([])
    expect(compareScripts(json(manifest), undefined)).toEqual([])
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

  it('reads a block that ends the file', () => {
    expect(workflowSteps('      - run: |\n          npm ci\n          npm test')).toEqual(['run: npm ci ; npm test'])
  })

  it('reads a block that says how it is indented or how it ends', () => {
    expect(workflowSteps('      - run: |2-\n          npm ci\n      - run: >+\n          npm test\n')).toEqual(['run: npm ci', 'run: npm test'])
  })

  it('reads a command that only starts or ends like the start of a block as a command', () => {
    expect(workflowSteps('      - run: |x\n      - run: ls |\n')).toEqual(['run: |x', 'run: ls |'])
  })

  it('reads a step with more than one space after its dash', () => {
    expect(workflowSteps('      -   run: npm ci\n      -\tuses: actions/checkout@v7\n')).toEqual(['run: npm ci', 'uses: actions/checkout'])
  })

  it('reads an action written in quotes as the action', () => {
    expect(workflowSteps(`      - uses: "actions/checkout@abc"\n      - uses: 'actions/setup-node@def' # v7\n`)).toEqual(['uses: actions/checkout', 'uses: actions/setup-node'])
  })

  it('reads an action without a version as the action, without the comment after it', () => {
    expect(workflowSteps('      - uses: ./.github/actions/setup # the setup\n  deploy:\n    uses: "./.github/workflows/deploy.yml"   # no version\n')).toEqual(['uses: ./.github/actions/setup', 'uses: ./.github/workflows/deploy.yml'])
  })

  it("keeps a # that is part of an action's name", () => {
    expect(workflowSteps('      - uses: ./.github/actions/c#\n')).toEqual(['uses: ./.github/actions/c#'])
  })

  it("doesn't take the shell a workflow sets for its commands for a step", () => {
    expect(workflowSteps('defaults:\n  run:\n    shell: bash\njobs:\n  check:\n    steps:\n      - run: npm ci\n')).toEqual(['run: npm ci'])
  })
})

describe('commands', () => {
  it.each([
    ['run: npm ci', ['npm ci']],
    ['run: npm run lint', ['npm run lint']],
    ['run: npm run test:coverage -- --coverage.reporter=text', ['npm run test:coverage']],
    ['run: npm run --silent test:mutants > mutants.md', ['npm run test:mutants']],
    ['run: npm test', ['npm test']],
    ['run: npx playwright test', ['npx playwright test']],
    ['run: npx playwright install --with-deps chromium', ['npx playwright install']],
    ['run: npx playwright install-deps chromium', ['npx playwright install-deps']],
    ['run: npx --yes wrangler@4 deploy', ['npx wrangler@4 deploy']],
    ['run: npx oxlint', ['npx oxlint']],
    ['run: node scripts/coverage-summary.mjs coverage/coverage-summary.json >> "$GITHUB_STEP_SUMMARY"', ['node scripts/coverage-summary.mjs']],
    ['run: if [ -f coverage.json ]; then ; node summary.mjs ; fi', ['node summary.mjs']],
    ['run: npm ci ; npm run build ; node server/main.ts', ['npm ci', 'npm run build', 'node server/main.ts']],
    ['run: docker run -d --name kinopeer -p 8080:8080 kinopeer:ci', ['docker run']],
    ['run: docker run -d kinopeer:ci ; curl -fsS http://localhost:8080/healthz ; docker exec kinopeer touch /data/.probe ; docker stop kinopeer', ['docker run', 'docker exec', 'docker stop']],
    ['run: docker buildx build --load .', ['docker buildx']],
    ['run: docker --debug build .', ['docker build']],
    ['uses: actions/setup-node', ['uses: actions/setup-node']],
    // A job's call of a reusable workflow is a `uses:` too.
    ['uses: ./.github/workflows/tmdb-proxy.yml', ['uses: ./.github/workflows/tmdb-proxy.yml']],
    // On purpose: the word before any other is read as the command, in a message too, since the guard marks too much rather than too little.
    ['run: echo "the docker image is ready"', ['docker image']],
    ['run: git commit -m "build the docker image in CI"', ['docker image']],
  ])('reads %s as %j', (step, expected) => {
    expect(commands(step)).toEqual(expected)
  })

  it.each([
    ['a command that is none of the four', 'run: curl -fsS http://localhost:8080/healthz ; echo ok'],
    ['Node asked for a value rather than given a script', 'run: echo "version=$(node -p "1")"'],
    ['a word that only ends like one', 'run: pnpm install ; xnode build.js ; gnpx tool ; xdocker run'],
    ['a word that only starts like one', 'run: docker-compose up ; dockerd'],
    ['docker with nothing to do', 'run: docker'],
    ['a command that only names an action', 'run: echo uses: actions/checkout'],
  ])('finds no command in %s', (_name, step) => {
    expect(commands(step)).toEqual([])
  })
})

describe('compareWorkflows', () => {
  const file = '.github/workflows/ci.yml'
  const compare = (head: string | undefined, base: string | undefined = WORKFLOW) => compareWorkflows([{ path: file, base, head, added: [] }])

  it('sends a command that is no longer run to the owner', () => {
    expect(said(compare(WORKFLOW.replace('      - run: npm run lint\n', '')))).toEqual(['owner: a command CI ran is no longer run: `npm run lint`'])
  })

  it('sends it to the owner also when another step takes its place', () => {
    expect(said(compare(WORKFLOW.replace('npm run lint', 'npm run format')))).toEqual(['owner: a command CI ran is no longer run: `npm run lint`'])
  })

  it('sends a command taken out of a block to the owner', () => {
    expect(said(compare(WORKFLOW.replace('node summary.mjs', 'true')))).toEqual(['owner: a command CI ran is no longer run: `node summary.mjs`'])
  })

  it('names a command once, however many steps ran it', () => {
    expect(said(compare(WORKFLOW.replaceAll('npm ci', 'npm install')))).toEqual(['owner: a command CI ran is no longer run: `npm ci`'])
  })

  it('sends one of two steps alike removed to a second review, since the command still runs', () => {
    const head = WORKFLOW.replace('  docker:\n    steps:\n      - run: npm ci\n', '  docker:\n    steps: []\n')
    expect(said(compare(head))).toEqual(['review: a CI step changed or is gone, it was: `run: npm ci`'])
  })

  it.each([
    ['a command with other arguments', WORKFLOW.replace('npm run lint', 'npm run lint -- --quiet'), 'run: npm run lint'],
    ['a command that is not a check changed', WORKFLOW.replace('echo\n          dry', 'echo\n          wet'), 'run: echo ; dry'],
  ])('sends %s to a second review', (_name, head, step) => {
    expect(said(compare(head))).toEqual([`review: a CI step changed or is gone, it was: \`${step}\``])
  })

  it('sends an action that no step calls any more to the owner', () => {
    const head = WORKFLOW.replace('        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n', '')
    expect(said(compare(head))).toEqual(['owner: a command CI ran is no longer run: `uses: actions/upload-artifact`'])
  })

  it('sends one of two steps of one action removed to a second review, since the action still runs', () => {
    const checkout = '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n'
    expect(said(compare(WORKFLOW, `${WORKFLOW}${checkout}`))).toEqual(['review: a CI step changed or is gone, it was: `uses: actions/checkout`'])
  })

  describe('a step of docker commands', () => {
    const smoke = (lines: string) => `jobs:\n  docker:\n    steps:\n      - uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0\n${lines}`
    const STEP = '      - name: Smoke test\n        run: |\n          docker run -d kinopeer:ci\n          curl -fsS localhost:8080/healthz\n          docker exec kinopeer true\n'

    it('goes to the owner when it is removed, each of its commands named', () => {
      expect(said(compare(smoke(''), smoke(STEP)))).toEqual(['owner: a command CI ran is no longer run: `docker run`', 'owner: a command CI ran is no longer run: `docker exec`'])
    })

    it('goes to the owner for the one command taken out of it', () => {
      expect(said(compare(smoke(STEP.replace('          docker exec kinopeer true\n', '')), smoke(STEP)))).toEqual(['owner: a command CI ran is no longer run: `docker exec`'])
    })

    it('goes to a second review when it is rewritten with its docker commands kept', () => {
      const head = smoke(STEP.replace('          curl -fsS localhost:8080/healthz\n', ''))
      expect(said(compare(head, smoke(STEP)))).toEqual(['review: a CI step changed or is gone, it was: `run: docker run -d kinopeer:ci ; curl -fsS localhost:8080/healthz ; docker exec kinopeer true`'])
    })
  })

  it.each([
    ['an action bumped', WORKFLOW.replace('3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', '0000000000000000000000000000000000000000 # v8.0.0')],
    ['a step added', WORKFLOW.replace('      - run: npm run lint\n', '      - run: npm run lint\n      - run: npm run typecheck\n')],
    ['steps in another order', WORKFLOW.replace('      - run:   npm ci  \n      - run: npm run lint\n', '      - run: npm run lint\n      - run: npm ci\n')],
    ['a comment changed', WORKFLOW.replace('# A comment, which is not a command.', '# Another comment.')],
  ])('finds nothing in %s', (_name, head) => {
    expect(compare(head)).toEqual([])
  })

  it('cuts a step of more than 120 characters short in what it says', () => {
    const step = (length: number) => `      - run: ${'x'.repeat(length - 'run: '.length)}\n`
    const what = (length: number) => compare(WORKFLOW, WORKFLOW + step(length))[0].what
    expect(what(120)).toBe(`a CI step changed or is gone, it was: \`run: ${'x'.repeat(115)}\``)
    expect(what(121)).toBe(`a CI step changed or is gone, it was: \`run: ${'x'.repeat(112)}…\``)
  })

  it('sends a removed workflow and each command only it ran to the owner', () => {
    expect(said(compare(undefined))).toEqual([
      'owner: the workflow is removed, and its steps with it',
      'owner: a command CI ran is no longer run: `uses: actions/checkout`',
      'owner: a command CI ran is no longer run: `npm ci`',
      'owner: a command CI ran is no longer run: `npm run lint`',
      'owner: a command CI ran is no longer run: `node summary.mjs`',
      'owner: a command CI ran is no longer run: `uses: actions/upload-artifact`',
    ])
  })

  it('finds nothing in a new workflow', () => {
    expect(compare(WORKFLOW, undefined)).toEqual([])
  })

  it('reads the workflows a branch changes together: a command moved to another one still runs', () => {
    const moved = compareWorkflows([
      { path: file, base: WORKFLOW, head: WORKFLOW.replace('      - run: npm run lint\n', ''), added: [] },
      { path: '.github/workflows/lint.yml', base: undefined, head: 'jobs:\n  lint:\n    steps:\n      - run: npm run lint -- --quiet\n', added: [] },
    ])
    expect(said(moved)).toEqual(['review: a CI step changed or is gone, it was: `run: npm run lint`'])
  })

  it('names a command two workflows lose once, at the first', () => {
    const lost = compareWorkflows([
      { path: file, base: WORKFLOW, head: WORKFLOW.replace('      - run: npm run lint\n', ''), added: [] },
      { path: '.github/workflows/lint.yml', base: '      - run: npm run lint\n', head: '      - run: npm run format\n', added: [] },
    ])
    expect(lost.map(({ needs, file: path, what }) => `${needs} ${path}: ${what}`)).toEqual(['owner .github/workflows/ci.yml: a command CI ran is no longer run: `npm run lint`'])
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
    ['playwright.config.ts', 'const retries = process.env.CI ? 2 : 0'],
    ['playwright.config.ts', '  retries,'],
    ['playwright.config.ts', '  use: { retries },'],
    ['playwright.config.ts', 'config.retries = 2'],
    ['playwright.config.ts', '  retries : 2,'],
    ['playwright.config.ts', "  ['retries']: 2,"],
    ['vite.config.ts', '      retry: isCI ? 2 : 0,'],
    ['vite.config.ts', '      retry: RETRIES,'],
    ['vite.config.ts', '      retry: Number(process.env.RETRY),'],
    ['vite.config.ts', '      retry:  3,'],
    ['src/App.test.tsx', "  it('goes straight in', { retry: flaky ? 3 : 0 }, () => {"],
    ['tmdb-proxy/package.json', '    "test": "vitest run --retry=2"'],
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
    ['a retry the app offers, as a function that waits', 'e2e/app.ts', '  retry: async () => {},'],
    ['a retry the app offers, as a function by its keyword', 'e2e/app.ts', '  retry: function () {},'],
    ['a retry key with its value on the next line', 'e2e/app.ts', '  retry:'],
    ['no retries, by the other name', 'vite.config.ts', '      retry: 0,'],
    ['no retries, as JSON writes it', 'package.json', '    "retries": 0,'],
    ['a retry the app offers, as a function that waits, written tight', 'e2e/app.ts', '  retry: async() => {},'],
    ['a test whose title ends with the word', 'src/api/tmdb/client.test.ts', "  it('waits and retries', async () => {"],
    ['a comment that ends with the word', 'e2e/smoke/onboarding.smoke.ts', '  // The server never retries'],
    ['a package named for it in the lockfile', 'package-lock.json', '    "node_modules/retry": {'],
    ["the app's own retries in a folder's manifest-like file", 'src/package.json.ts', '  const options = { retries: 3 }'],
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

  it.each([
    ['a lint rule turned off for a file', 'src/App.tsx', '/* oxlint-disable react/rules-of-hooks */', 'a check is turned off in the code'],
    ['a lint rule turned off for a line, the way ESLint writes it', 'server/main.ts', '  // eslint-disable-next-line no-console', 'a check is turned off in the code'],
    ['lines left out of coverage', 'src/lib/format.ts', '  /* v8 ignore next 3 */', 'a check is turned off in the code'],
    ['lines left out of coverage, by an older name', 'src/lib/format.ts', '  /* c8 ignore start */', 'a check is turned off in the code'],
    ['lines left out of coverage, by the oldest name', 'src/lib/format.ts', '  /* istanbul ignore next */', 'a check is turned off in the code'],
    ['lines left out of the mutants', 'server/tmdb.ts', '  // Stryker disable next-line all', 'a check is turned off in the code'],
    ['a type error ignored', 'src/App.test.tsx', '    // @ts-ignore', 'a check is turned off in the code'],
    ['a type error expected', 'e2e/app.ts', '  // @ts-expect-error the fake has no such field', 'a check is turned off in the code'],
    ['a file left out of the type check', 'scripts/mutants.mjs', '// @ts-nocheck', 'a check is turned off in the code'],
    ['a screenshot test skipped', 'e2e/search.spec.ts', "  test.skip('shows the results', async ({ page }) => {", 'a test is skipped or expected to fail'],
    ['a journey marked to fix later', 'e2e/smoke/tabs.smoke.ts', "test.fixme('keeps the place', async ({ page }) => {", 'a test is skipped or expected to fail'],
    ['a group of screenshot tests skipped', 'e2e/search.spec.ts', "test.describe.skip('results', () => {", 'a test is skipped or expected to fail'],
    ['a journey expected to fail', 'e2e/smoke/tabs.smoke.ts', "test.fail('keeps the place', async ({ page }) => {", 'a test is skipped or expected to fail'],
    ['a test left to write', 'src/App.test.tsx', "  it.todo('goes straight in')", 'a test is skipped'],
    ['a test skipped on a condition', 'server/tmdb.test.ts', "  it.skipIf(process.env.CI)('answers', async () => {", 'a test is skipped'],
    ['a test run on a condition', 'src/lib/format.test.ts', "  test.runIf(!process.env.CI)('formats', () => {", 'a test is skipped'],
    ['a group of tests skipped on a condition', 'src/lib/format.test.ts', "describe.skipIf(isCI)('sizes', () => {", 'a test is skipped'],
    ['screenshots not compared, in a config', 'playwright.config.ts', '  ignoreSnapshots: true,', 'screenshots are no longer compared'],
    ['screenshots rewritten on every run', 'playwright.config.ts', "  updateSnapshots: 'all',", 'screenshots are no longer compared'],
    ['screenshots not compared, in a script CI calls', 'package.json', '    "test:visual": "playwright test --ignore-snapshots",', 'screenshots are no longer compared'],
    ['screenshots not compared, in a workflow', '.github/workflows/ci.yml', '      - run: npx playwright test --ignore-snapshots', 'screenshots are no longer compared'],
    ['a command that swallows its failure with a colon', '.github/workflows/ci.yml', '      - run: npm run lint || :', 'a CI step can fail without failing the run'],
    ['a command that swallows its failure with a colon, more after it', '.github/workflows/ci.yml', '          npm run lint ||: ; npm test', 'a CI step can fail without failing the run'],
    ['a command that leaves with success on a failure', '.github/workflows/ci.yml', '      - run: npm run lint || exit 0', 'a CI step can fail without failing the run'],
    ['a block that goes on after a failure', '.github/workflows/ci.yml', '          set +e', 'a CI step can fail without failing the run'],
    ['a step allowed to fail', '.github/workflows/ci.yml', '        continue-on-error: true', 'a CI step can fail without failing the run'],
    ['a step allowed to fail by an expression', '.github/workflows/ci.yml', "        continue-on-error: ${{ github.event_name == 'pull_request' }}", 'a CI step can fail without failing the run'],
    ['a command that swallows its failure', '.github/workflows/ci.yml', '      - run: npm run lint || true', 'a CI step can fail without failing the run'],
    ['a command that swallows its failure, written tight', '.github/workflows/ci.yml', '      - run: npm run lint ||true', 'a CI step can fail without failing the run'],
    ['a path filter on a trigger', '.github/workflows/ci.yml', '    paths:', 'a workflow got a path filter, so it runs for fewer changes'],
    ['paths a trigger ignores', '.github/workflows/ci.yml', "    paths-ignore: ['docs/**']", 'a workflow got a path filter, so it runs for fewer changes'],
    ["a job under the guard's name", '.github/workflows/ci.yml', '  guard:', "a job or a status with the guard's name, which can report in its place"],
    ['a job named for the guard', '.github/workflows/ci.yml', '    name: guard', "a job or a status with the guard's name, which can report in its place"],
    ['a job named for the guard, in quotes', '.github/workflows/lint.yml', "    name: 'guard'", "a job or a status with the guard's name, which can report in its place"],
    ['a step named for the guard', '.github/workflows/ci.yml', '      - name: guard', "a job or a status with the guard's name, which can report in its place"],
    ['a job named for the guard after more than one space', '.github/workflows/ci.yml', '    name:   guard', "a job or a status with the guard's name, which can report in its place"],
    ["a status set under the guard's name", '.github/workflows/ci.yml', '          gh api "repos/$REPO/statuses/$SHA" -f state=success -f context=guard', "a job or a status with the guard's name, which can report in its place"],
    ["a status set under the guard's name by a script", '.github/workflows/ci.yml', "              context: 'guard',", "a job or a status with the guard's name, which can report in its place"],
    ["a status set under the guard's name as JSON", '.github/workflows/ci.yml', `          -d '{"state":"success","context":"guard"}'`, "a job or a status with the guard's name, which can report in its place"],
    ["a job under the guard's name with a comment after it", '.github/workflows/ci.yml', '  guard:  # runs the guard', "a job or a status with the guard's name, which can report in its place"],
    ['a job named for the guard with a comment after it', '.github/workflows/ci.yml', '    name: guard # the check', "a job or a status with the guard's name, which can report in its place"],
    ["a check run made under the guard's name", '.github/workflows/ci.yml', '          gh api "repos/$REPO/check-runs" -f name=guard -f head_sha="$SHA" -f conclusion=success', "a job or a status with the guard's name, which can report in its place"],
    ["a check run made under the guard's name as JSON", '.github/workflows/ci.yml', `          -d '{"name": "guard", "head_sha": "abc", "conclusion": "success"}'`, "a job or a status with the guard's name, which can report in its place"],
  ])('sends %s to the owner', (_name, file, text, what) => {
    expect(scanAdded(file, lines(text))).toEqual([{ needs: 'owner', file, line: 10, what: `${what}: \`${text.trim()}\`` }])
  })

  it.each([
    ['a condition on a step', '        if: always()'],
    ['a condition that starts a step', "      - if: steps.chromium.outputs.cache-hit != 'true'"],
    ['a condition on a job', '    if: ${{ !github.event.pull_request.draft }}'],
  ])('sends %s to a second review', (_name, text) => {
    const file = '.github/workflows/ci.yml'
    expect(scanAdded(file, lines(text))).toEqual([{ needs: 'review', file, line: 10, what: `a CI step or job got a condition: \`${text.trim()}\`` }])
  })

  it.each([
    ['a doc that names a way to turn a check off', 'docs/TESTING.md', 'no `oxlint-disable` without a reason, no `test.skip`'],
    ['a skipped test outside e2e, which the linter stops', 'src/App.test.tsx', "  it.skip('goes straight in', () => {"],
    ['a call that only starts like a skip', 'e2e/app.ts', '  test.skipper(page)'],
    ['a call that only starts like an expected failure', 'e2e/app.ts', '  test.failure(page)'],
    ['a test left to write in e2e, where Playwright has no such call', 'e2e/search.spec.ts', "  test.todo('shows the results')"],
    ['a condition of the same name on something that is not a test', 'src/lib/format.test.ts', '  flags.skipIf(true)'],
    ['a call that only starts like a condition on a test', 'src/lib/format.test.ts', "  it.runIfNeeded('formats')"],
    ['a skip on a condition outside the tests', 'src/lib/format.ts', '  it.skipIf(true)'],
    ['a word that only starts like the setting', 'playwright.config.ts', '  ignoreSnapshotsDir: true, updateSnapshotsOf: 1,'],
    ['a flag that only starts like the one', 'package.json', '    "test:visual": "playwright test --ignore-snapshots-dir=x",'],
    ['the setting named in the app', 'src/screens/Settings.tsx', '  const ignoreSnapshots = true'],
    ['a command that leaves with a failure', '.github/workflows/ci.yml', '      - run: npm run lint || exit 1'],
    ['a command that falls back to a colon-started word', '.github/workflows/ci.yml', '      - run: npm run lint || :lint'],
    ['a block that stops at a failure', '.github/workflows/ci.yml', '          set -e'],
    ['a block that goes on after a failure, in a script', 'scripts/test-visual.sh', 'set +e'],
    ['a step that may not fail', '.github/workflows/ci.yml', '        continue-on-error: false'],
    ['a step that may not fail, written tight', '.github/workflows/ci.yml', '        continue-on-error:false'],
    ['a command that swallows its failure in a script', 'scripts/test-visual.sh', 'docker rm kinopeer || true'],
    ['a command that falls back to another', '.github/workflows/ci.yml', '      - run: npm ci || truecolor'],
    ['an artifact path', '.github/workflows/ci.yml', '          path: coverage'],
    ['a list of paths under a key of an action', '.github/workflows/ci.yml', '          key: paths: none'],
    ['a condition in a shell command', '.github/workflows/ci.yml', '          elif: [ -f coverage.json ]'],
    ['a condition written in a config, not a workflow', 'vite.config.ts', '  if: true,'],
    ['a path filter written in a config, not a workflow', 'vite.config.ts', '  paths: [],'],
    ["a job whose name only starts like the guard's", '.github/workflows/ci.yml', '  guard-tests:'],
    ["a job whose name only ends like the guard's", '.github/workflows/ci.yml', '  safeguard:'],
    ["a name that goes on after the guard's", '.github/workflows/ci.yml', '    name: guard the gate'],
    ["a status whose name only starts like the guard's", '.github/workflows/ci.yml', '          gh api "$URL" -f context=guardian'],
    ["a status of another name that mentions the guard", '.github/workflows/ci.yml', '          gh api "$URL" -f context=lint -f description=guard'],
    ["a check run whose name only starts like the guard's", '.github/workflows/ci.yml', '          gh api "$URL" -f name=guardian'],
    ["a check run whose name only ends like the guard's", '.github/workflows/ci.yml', '          gh api "$URL" -f rename=guard -f nickname=guard'],
    ["a name that goes on after the guard's, with a comment", '.github/workflows/ci.yml', '    name: guard the gate # guard'],
    ["a comment that names the guard", '.github/workflows/ci.yml', '      # guard'],
    ["the guard's name as a key in a config, not a workflow", 'vite.config.ts', '  guard:'],
  ])('finds nothing in %s', (_name, file, text) => {
    expect(scanAdded(file, lines(text))).toEqual([])
  })

  it.each([
    ['a dependency named for it in a manifest', 'package.json', '    "p-retry": "^6.0.0",'],
    ['a title with the word before a colon', 'src/screens/ReleasesBlock.test.tsx', "  it('shows retry: the button', () => {"],
    ['another tool told to retry in a workflow', '.github/workflows/ci.yml', '          curl --retry 5 http://localhost:8080/healthz'],
  ])('marks %s too, as the price of reading names: too much rather than too little', (_name, file, text) => {
    expect(scanAdded(file, lines(text))).toEqual([{ needs: 'owner', file, line: 10, what: `test retries appeared: \`${text.trim()}\`` }])
  })

  it('names the line of each match', () => {
    expect(scanAdded('playwright.config.ts', lines('  use: {},', '  retries: 2,')).map(({ line }) => line)).toEqual([11])
  })
})

describe('findings', () => {
  it.each(['scripts/guard/signs.ts', 'scripts/guard/guard.test.ts', '.github/workflows/guard.yml', 'docs/QUALITY.md', '.claude/skills/second-review/SKILL.md'])('sends a change to the guard or its rules to the owner: %s', (path) => {
    // With a line that would be a finding of its own anywhere else: the guard's files hold the patterns as text.
    expect(findings([{ path, base: 'jobs: {}', head: 'jobs: {}', added: [{ line: 1, text: '  retries: 2,' }] }])).toEqual([{ needs: 'owner', file: path, what: 'the checks guard or its rules changed' }])
  })

  it.each(['tmdb-proxy/scripts/guard/signs.ts', 'scripts/guardian.ts', 'docs/.github/workflows/guard.yml', '.github/workflows/guard.yml.md', 'QUALITY.md', 'docs/QUALITY.md.bak', '.claude/skills/test-review/SKILL.md', '.claude/skills/second-reviews/SKILL.md', 'docs/.claude/skills/second-review/SKILL.md'])("doesn't take %s for the guard", (path) => {
    expect(findings([{ path, added: [] }])).toEqual([])
  })

  it.each([
    ['src/lib/.oxlintrc.json', 'owner', 'a lint config outside the root, which the linter obeys for its folder, is added or changed'],
    ['.eslintignore', 'owner', 'a file of paths the linter skips is added or changed'],
    ['e2e/.oxlintignore', 'owner', 'a file of paths the linter skips is added or changed'],
    ['tsconfig.json', 'review', "the type check's config changed"],
    ['tmdb-proxy/tsconfig.worker.json', 'review', "the type check's config changed"],
  ])('marks %s by its path, whatever it says', (path, needs, what) => {
    expect(findings([{ path, added: [{ line: 1, text: '{}' }] }])).toEqual([{ needs, file: path, what }])
  })

  it("marks the type check's config removed, and not a lint file that only lost lines", () => {
    const removed = (path: string) => findings([{ path, added: [] }]).map(({ needs }) => needs)
    expect(removed('tsconfig.app.json')).toEqual(['review'])
    expect(removed('src/lib/.oxlintrc.json')).toEqual([])
    expect(removed('.eslintignore')).toEqual([])
  })

  it.each(['src/lib/oxlintrc.json', 'src/.eslintignore.md', 'src/tsconfig.ts', 'docs/tsconfig.md', 'src/mytsconfig.json', 'tsconfigs.json'])("doesn't take %s for one of them", (path) => {
    expect(findings([{ path, added: [{ line: 1, text: '{}' }] }])).toEqual([])
  })

  it('reads each file by its own rules and a workflow by both the steps and the lines', () => {
    const found = findings([
      { path: 'checks.json', base: '{"coverage":{"thresholds":{"lines":96}}}', head: '{"coverage":{"thresholds":{"lines":90}}}', added: [] },
      { path: '.oxlintrc.json', base: '{"rules":{"no-console":"error"}}', head: '{"rules":{}}', added: [] },
      { path: '.github/workflows/ci.yml', base: '      - run: npm test\n', head: '      - run: npm test -- --retry=2\n', added: [{ line: 1, text: '      - run: npm test -- --retry=2' }] },
      { path: 'package.json', base: '{"scripts":{"lint":"oxlint"}}', head: '{"scripts":{"test":"vitest run --retry=2"}}', added: [{ line: 1, text: '{"scripts":{"test":"vitest run --retry=2"}}' }] },
      { path: 'tmdb-proxy/package.json', base: '{"scripts":{"lint":"oxlint"}}', head: '{}', added: [] },
      { path: 'src/App.tsx', added: [{ line: 1, text: 'export const retries = 2' }] },
    ])
    expect(found.map(({ needs, file }) => `${needs} ${file}`)).toEqual([
      'owner checks.json',
      'owner .oxlintrc.json',
      'owner .github/workflows/ci.yml',
      'owner package.json',
      'owner package.json',
      'review .github/workflows/ci.yml',
    ])
  })

  it.each(['src/sum.test.ts', 'src/App.test.tsx', 'e2e/list.spec.ts', 'e2e/smoke/test.ts'])('compares what the tests of %s assert', (path) => {
    const file = (body: string) => `it('adds', () => {\n${body}})\n`
    expect(findings([{ path, base: file('  expect(a).toBe(1)\n'), head: file(''), added: [] }])).toEqual([
      { needs: 'review', file: path, line: 1, what: '1 of 1 assertions in `adds` rewritten or removed, the first: `expect(a).toBe(1)`' },
    ])
  })

  it.each(['src/sum.ts', 'src/test/render.tsx', 'e2e/__screenshots__/list.png', 'e2e/README.md', 'docs/sum.test.ts.md', 'scripts/guard/signs.test.ts'])("doesn't read %s as tests", (path) => {
    const file = (body: string) => `it('adds', () => {\n${body}})\n`
    expect(findings([{ path, base: file('  expect(a).toBe(1)\n'), head: file(''), added: [] }]).filter(({ needs }) => needs === 'review')).toEqual([])
  })

  it("leaves the guard's own workflow to the mark on the guard", () => {
    const found = findings([{ path: '.github/workflows/guard.yml', base: '      - run: npm run guard\n', head: '', added: [] }])
    expect(found).toEqual([{ needs: 'owner', file: '.github/workflows/guard.yml', what: 'the checks guard or its rules changed' }])
  })
})

describe('readsWhole', () => {
  it.each(['checks.json', '.oxlintrc.json', 'package.json', '.github/workflows/ci.yml', '.github/workflows/build.yaml', 'src/sum.test.ts', 'src/App.test.tsx', 'e2e/list.spec.ts', 'e2e/app.tsx'])('reads %s whole', (path) => {
    expect(readsWhole(path)).toBe(true)
  })

  it.each(['src/App.tsx', 'e2e/__screenshots__/list.png', 'e2e/list.spec.ts.md', 'docs/e2e/list.spec.ts', 'src/sum.test.tsx.snap', 'tmdb-proxy/checks.json', 'tmdb-proxy/package.json', '.github/dependabot.yml', '.github/workflows/README.md', 'tmdb-proxy/.github/workflows/ci.yml', '.github/workflows/drafts/ci.yml', '.github/workflows/yml'])('reads only the added lines of %s', (path) => {
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
      '**For the owner: 1 to approve, each with a reason.** A weakening of the checks, or a change to the guard or its rules.',
      '',
      '- `playwright.config.ts:16`: test retries appeared: `retries: 2,`',
      '',
      "**For a second review: 1.** Changes to existing checks, which a script can't judge.",
      '',
      '- `checks.json`: the threshold `coverage.thresholds.lines` changed: `96` → `97`',
    ])
  })

  it('says under each list what record it needs, when told', () => {
    const found: Finding[] = [
      { needs: 'review', file: 'tsconfig.json', what: "the type check's config changed" },
      { needs: 'owner', file: 'checks.json', what: 'the file is removed' },
    ]
    expect(report(found, at, { owner: 'The owner’s record.', review: 'The second review’s record.' }).split('\n').slice(2)).toEqual([
      '',
      '**For the owner: 1 to approve, each with a reason.** A weakening of the checks, or a change to the guard or its rules.',
      '',
      '- `checks.json`: the file is removed',
      '',
      'The owner’s record.',
      '',
      "**For a second review: 1.** Changes to existing checks, which a script can't judge.",
      '',
      '- `tsconfig.json`: the type check\'s config changed',
      '',
      'The second review’s record.',
    ])
    // Only under a list that is there.
    expect(report([found[0]], at, { owner: 'The owner’s record.' })).not.toContain('record')
  })

  it('lists a finding about the branch as a whole without a file', () => {
    expect(report([{ needs: 'owner', what: "the branch's run gave no list of its tests" }], at).split('\n').at(-1)).toBe("- the branch's run gave no list of its tests")
  })
})
