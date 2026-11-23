# Quality

Kinopeer's code is written and reviewed by AI agents. Its quality is held by three things: the
automated checks, an independent review by the deputy, a session that didn't write the change,
and the owner's look at how the app behaves. This file says which parts of that system are in force here, and it
owns the rules of the checks guard and the retro. How the tests are organized and how a PR's tests are reviewed
is in [TESTING.md](TESTING.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

The guard marks any change to this file, and the deputy judges it as a change to the rules (the `deputy` skill → The owner's approval).

## Components

Only what is on, being adopted, or declined with its reason; plans aren't listed.

| Component | State | What it does |
| --- | --- | --- |
| [The testing rules](TESTING.md) | On, version 2.2 of the quality system's testing component (2026-11-20), of which [TESTING.md](TESTING.md) is the source | How a change is covered by tests and reviewed: the lowest layer that sees a statement, the neighbours of a change, a test seen to fail, the accepted reasons for something uncovered, what a bug calls for and its seven `test-gap` classes, the review rounds and their tags |
| The effort journal | On since 2026-11-14: built outside this repository, in the owner's `ai-workspace` (`effort-journal/`). Its hook records every session's turns on the owner's Mac into a database of the owner's on Cloudflare. Until 2026-11-17 it recorded into a Google Sheet behind a webhook; that day it moved to the database, with the Sheet's rows carried over. A cloud session (the deputy's runs, a cloud author or coordinator) records only when its environment has the journal's variables, and the deputy stops when it can't reach the journal (the `deputy` skill → Whether to run). Until 2026-11-15 a cloud run's rows didn't reach the Sheet: the cloud's network refused the webhook's hosts, and the hook kept a run's one turn in a spool that waited five minutes and went with the container. Both were fixed that day, in the cloud environment's network and in the journal, which sends at once in a cloud session. A cloud run's rows first reached the Sheet on 2026-11-15, from the deputy's round 2 on #447; every cloud run before it is missing from the journal ([The retro](#the-retro)) | Records what each session's work costs and rates each merged PR's complexity, which the retro sets against each other ([The retro](#the-retro)); the figures stay out of this repository, which is public |
| [The retro](#the-retro) | On since 2026-10-28 as the tests' retro, the whole system's since 2026-11-14, by version 3.3 of the quality system's retro (2026-11-20); its counts come from the quality system's database since 2026-11-20 ([Where the counts come from](#the-retro)) | Every fifty merged PRs, reads the review findings, the escaped bugs, the effort against complexity, the checks' usefulness and the owner's points, and changes the rules where a pattern repeats |
| [The checks guard](#the-checks-guard) | On since 2026-11-12 (#366); a report only since 2026-11-15: its `guard` job, among `main`'s required checks, passes whatever it marks and fails only when the guard breaks or can't write its report | A script CI runs on every PR, which writes into the PR's `guard report` check what in it weakens the checks, changes existing ones or adds a design value, for the deputy's round to judge |
| The design tokens check | On since 2026-11-14 (#411): a test in CI's `check` job, which is among `main`'s required checks | `src/styles/tokens.test.ts` fails a stylesheet's spacing, radius, type size, color, shadow or motion that the tokens have, and one they lack unless its line carries a comment saying why, and a `var()` that names a property nothing defines. What counts as a raw value is defined in `scripts/guard/stylesheets.ts`, which the guard reads too ([What it marks](#what-it-marks)) |
| The texts check | On since 2026-11-14 (#413): an oxlint rule, `react/jsx-no-literals`, that CI's `check` job runs | Fails a string that is a whole child in the app's JSX or the quoted value of an attribute a user reads or hears, so UI copy goes through translation keys; a string in braces in an attribute, inside an expression or outside JSX is left to review |
| The module boundaries check | On since 2026-11-14 (#414): an override of oxlint's rules for the pure logic folders, which CI's `check` job runs | Fails a module in `src/releases/`, `src/search/`, `src/torrents/` or `src/logic/` (hooks, providers and tests aside) that imports React, React Router, react-i18next, a Node built-in, a hook, a screen or a component, reads a global the browser or Node has but other platforms lack, or holds JSX, so pure logic runs anywhere (`docs/ARCHITECTURE.md` → Pure logic). Its cases are in `src/logic/pureModules.test.ts`; the guard marks widening what it allows (a global, a file left out, a rule turned off) as a weakening and a rule's options changed as a change to an existing check, and the deputy's round judges both |
| [The size budget](#the-size-budget) | On since 2026-11-12 (#378): a step of CI's `performance` job, which is among `main`'s required checks | Sums the build's JS and CSS gzipped and everything else as it is, and fails over the budgets in `checks.json` |
| [The requests budget](#the-requests-budget) | Being adopted (#378): a step of CI's `performance` job, which is among `main`'s required checks | Opens each screen afresh in a browser and moves between screens in short journeys, counts what each opening and each move asks each server route for, and fails on any count that isn't its budget in `checks.json` |
| [The layout shift budget](#the-layout-shift-budget) | Being adopted (#378, #387): a test in CI's `performance` job, beside the requests budget's, which is among `main`'s required checks | Opens each screen on a phone and on desktop in a browser, lets the answers it loads from land one at a time in two orders, sums how far its content moves, and fails over its budget in `checks.json` |
| [The accessibility budget](#the-accessibility-budget) | Being adopted (2026-11-14): a part of every screenshot test in CI's `visual` job, which is among `main`'s required checks | Has axe read the state each screenshot shows against WCAG 2.2 AA, counts the elements that break each rule, and fails on any count that isn't its budget in `checks.json` |

## The checks guard

The sessions that write the code also write its checks, so a change can weaken a check to get
itself through: lower a threshold, turn a lint rule off, drop a CI step. The checks guard is a
script with no AI in it (`scripts/guard/`) that compares a branch with the commit it left `main`
at and marks what in its changes does that. It marks too much rather than too little: what it
can't read or can't judge is marked, not passed.

### What it marks

Three kinds of change, three lists in its report. The deputy's round judges every mark (the
`deputy` skill → The round), and the retro reads what it accepted ([The retro](#the-retro)).

**Weakens the checks**: a weakening of the checks, or a change to the guard or its rules.

- A coverage threshold lowered or removed, a path added to what coverage leaves out, or one removed
  from what it measures (`coverage` in `checks.json`).
- A mutator added to those Stryker leaves out, a pattern added to the files it doesn't mutate, a
  test added to those its runs leave out, or a folder removed from those it does (`mutants` in
  `checks.json`).
- A budget raised, removed or no longer a number (`budgets` in `checks.json`, where more is
  weaker; the screenshots' threshold, `budgets.screenshotThreshold`, among them), a new rule's budget in an accessibility state `main` has budgets for among them: a rule a
  state doesn't name counts as 0 there, so its new budget is raised from 0. A budget lowered isn't
  marked: it checks more.
- A lint rule removed, turned off or downgraded, at the top level or in an override; a rule turned
  off that the config didn't name before, since it may have been on by default; a plugin removed,
  at the top level or from an override's `plugins` or `jsPlugins`; an environment turned on or a
  global allowed (`env`, `globals`, at the top level or in an override), which `no-undef` then lets
  through, and one no longer turned off or taken away (a `false` environment or an `'off'` global
  removed); a path added to `ignorePatterns` or to an override's `excludeFiles`, the files its rules
  skip (the root `.oxlintrc.json`). An
  override is known by its `files`, so one whose `files` change is one removed and one added. An
  override added or removed is marked whole as a weakening, with its JSON (one added with its place in the list), even one that checks
  more: read key by key against an empty one, it left a case unmarked in each round of #415's
  review, and overrides change rarely. Only an override that keeps its `files` is read key by key,
  as above. The overrides are marked whole, both sides' lists, when they can't be paired that way:
  one isn't an object or has no `files` list, two share their `files`, or those on both sides are in
  another order, since a later override wins where their files overlap.
- The linter turned off from another file, marked by the file's path whatever it says: an
  `.oxlintrc.json` outside the root, which oxlint obeys for its folder, or an `.eslintignore` or
  `.oxlintignore`, added or with lines added. `npm run lint` also runs oxlint with
  `--disable-nested-config`, so a nested config does nothing even unmarked.
- A command CI ran that is no longer run: an npm script (`npm run lint`, `npm ci`), a tool through
  npx with its subcommand (`npx playwright test`), a script through `node`, `docker` with its
  subcommand (`docker run`, `docker exec`), or an action or a reusable workflow (`uses:`, by its
  name without the version), which a workflow's step called on `main` and no step calls on the
  branch, wherever the step went; and a workflow removed (`.github/workflows/`). The guard reads the workflows the
  branch changes, so a command that an unchanged workflow still runs is marked all the same, and
  so is an action that only prepares a job (`actions/cache`), dropped from the workflows changed.
  It reads them with a YAML parser (`yaml`) as GitHub does, YAML 1.2: only a job's `uses` and its
  steps' `uses` and `run`, with aliases resolved and no merge keys, which YAML 1.2 doesn't have
  (GitHub's docs on YAML anchors and aliases cite the 1.2.2 spec); a command built by an expression
  is read as written, and a shell comment is left out, as bash reads one but for the spellings
  under [What it doesn't see](#what-it-doesnt-see): a `#` that starts a word outside quotes (after
  a space, a tab, a newline or an operator's character, `npm test;# npm run lint`, but not after
  another of the characters JavaScript counts as blanks or line breaks, a no-break space or U+2028
  among them, which bash doesn't), to the end of its line, also
  where a folded block folds it into the line before, while a `#` inside quotes or escaped is text;
  and every line whose `#` comes first or after spaces and tabs only, inside quotes too. Its tests
  keep a table of the
  spellings it reads, lets through and can't read (`scripts/guard/signs.test.ts`).
- An npm script removed (`scripts` in the root `package.json`): the step that called it checks
  nothing.
- In a line the branch adds:
  - test retries: `retries` as a name in the code (a key with anything but 0, a variable assigned
    or passed on), `retry` as a key with any value but 0, a mock or a function, `--retry` and
    `--retries`. Looked for in the tests, the configs in the root, every `package.json`, the
    workflows and the scripts; not in the app's code, which has retries of its own, nor in a
    lockfile, which may name a package so. Reading names marks more than tests' retries, on
    purpose: a dependency called `p-retry` in `package.json`, a test's title with `retry:` in it,
    `curl --retry` in a workflow;
  - a screenshot tolerance: `maxDiffPixels`, `maxDiffPixelRatio` or `threshold`, in `e2e/` and the
    Playwright configs;
  - a check turned off in the code: `oxlint-disable` and `eslint-disable` (oxlint obeys both),
    `v8 ignore`, `c8 ignore` and `istanbul ignore`, `Stryker disable`, `@ts-ignore`,
    `@ts-expect-error` and `@ts-nocheck`, in any file but a doc;
  - a test skipped or expected to fail in `e2e/`: `test.skip`, `test.fixme`, `test.fail` and the
    same on `test.describe`; `test.only` fails CI by Playwright's `forbidOnly`;
  - a test skipped in the Vitest tests in a way oxlint lets through: `.todo`, `.skipIf` and
    `.runIf` on `it`, `test` and `describe` (oxlint stops `.skip` and `.only`);
  - screenshots no longer compared: `ignoreSnapshots`, `updateSnapshots` or `--ignore-snapshots`,
    in the same files as the retries;
  - a CI step that can fail without failing the run: `continue-on-error`, or `|| true`, `|| :`,
    `|| exit 0` or `set +e` in a workflow's command;
  - a path filter on a workflow's trigger (`paths`, `paths-ignore`), so it runs for fewer changes;
  - a job, a commit status or a check run under the guard's name or its report's (`guard
    report`) in a workflow other than `guard.yml` (`guard:` as a job's key, `name: guard` or
    `name: guard report`, `context=guard` for the statuses API, `name=guard`, `name: 'guard'` or
    `"name": "guard report"` for the checks API), which could report in the guard's place.
- Fewer tests run: a test that `main`'s run has and the branch's doesn't (removed, skipped, its
  row gone from a table), in a file where the branch runs fewer tests than `main` does, when it
  also runs fewer in all. A test is its file and its name with its groups'. The lists come from the
  runs themselves ([How it runs](#how-it-runs)): the Vitest tests that passed or failed, so not a
  skipped one, and the browser tests Playwright lists, once per project, without those it skips.
- A report of the branch's run that is missing or gave no tests (`vitest.json`, one of
  Playwright's lists): the guard can't see a test of it that is gone. Only the reports that gave
  tests on both sides are compared and counted.
- `checks.json`, `.oxlintrc.json` or `package.json` that is no longer a JSON object the guard can
  read, a list in `checks.json` that is no longer a list, and `checks.json` or `.oxlintrc.json`
  removed.
- A workflow the guard can't read as one YAML 1.2 document (an error in it, two documents, a
  `%YAML` directive other than 1.2, a tag the parser can't resolve, YAML 1.1's tags among them, as
  `!!merge <<:` and `!!binary`), in place of its steps: GitHub wouldn't run it, or might read it
  otherwise.
- Any change to `scripts/guard/`, `.github/workflows/guard.yml`, this file or the deputy's
  procedure (`.claude/skills/deputy/`), which judges the marks.

**Design values**: a design value added or changed. A value the design doesn't have yet needs a
reason why the tokens' scale lacks it.

- A declaration added, changed or removed in `src/styles/tokens.css`, in either theme: each is
  known by the selector and the media queries it sits in and by its name, and its value is compared
  without comments and runs of spaces, so a token reformatted, commented or moved within its block
  isn't marked, and one moved to another block is removed there and added here. `!important` counts
  as part of the value, and a name declared twice in one block is compared with both values. An
  at-rule that holds no declaration, such as an `@import` of another stylesheet, is marked when it
  is added or removed, since the tokens it brings can't be read. `tokens.css` removed, or a copy on
  either side that the guard can't parse, is marked too. `tokens.test.ts` fails a token's name
  declared in any other stylesheet, which would override it there. The layout's sizes
  and the properties the app sets at runtime (the safe areas, the navigation's and the drawer's
  widths, the keyboard's inset) live in `src/styles/layout.css`, so that whatever is in
  `tokens.css` is a design value.
- A value off the tokens' scale on a line the branch adds to a stylesheet under `src/`
  (`tokens.css` aside) that `tokens.test.ts` lets through only because the line carries a comment:
  a spacing, radius or type size in px the scale doesn't have, a raw color, a `data:` URL, a raw
  shadow or raw motion. What counts as raw is the test's own definition,
  `scripts/guard/stylesheets.ts`, which the guard reads against the scale and the custom
  properties of every stylesheet at the branch's head (a shadow's `var()` is followed into them).
  A `box-shadow` or `text-shadow` line the branch adds that takes a commented raw shadow through
  `var()` is marked too, with where the shadow comes from; a custom property the branch changes in
  between, or a `filter` that takes one, isn't.
  A line the branch changes counts as added, so a comment written onto a raw value's line is marked
  as well. When the guard can't parse the stylesheets, every one the branch changes is marked. A raw
  value without a comment isn't marked: the test fails it, and CI with it. Nor is a size in a new
  custom property outside `tokens.css` (`--gutter: 13px;` in `layout.css`, then `gap:
  var(--gutter)`): the test reads sizes only where they're used, and `layout.css` holds the layout's
  sizes by design, so that one is left to review.

**Changes to existing checks**: a change to an existing check that a script can't judge.

- Any other change to `checks.json`: a threshold raised, a new budget (an accessibility state's
  only when the state is new), an entry removed from an exclusion list, a key the guard has no rule
  for.
- Any other change to `.oxlintrc.json`: a rule's options, also when its severity went up with
  them; a new rule that only warns; a key the guard has no rule for, at the top level or in an
  override (`settings`, say).
- A CI step that changed or is gone, when every command it called still runs somewhere or it
  called none of the kinds above (plain shell, `curl`): other arguments, a line taken out of a
  step whose commands stay, one of two steps alike removed. An action's version and inputs
  aren't part of the step, so a bump isn't a change.
- An npm script changed: a script can't tell whether it does less.
- Any change to a `tsconfig*.json`, by its path: the type check has too many settings for a list
  of them, and these files change in about two PRs of a hundred.
- A condition added to a CI step or job (`if:`): most are fair, as `if: always()` on a summary is.
- A test `main`'s run has and the branch's doesn't, where the branch runs no fewer tests in that
  file or in all: renamed, moved to another file, or replaced by another, which a script can't
  tell apart.
- An assertion rewritten or removed inside a test that both sides have by its name, in a test
  file the branch changes (`*.test.ts(x)` and the code in `e2e/`). The guard parses both copies
  and takes, test by test, every call that starts from `expect` or `assert` (a helper named
  `expectRow` too), as written, and every row of the table an `each` runs the test over, since a
  row holds what is expected (a table given by a name the file declares more than once, as two
  groups' `rows`, is every such list): one that `main`'s copy has and the branch's doesn't is marked at the
  test's line, with how many of the test's and the first of them. So is one asserted outside the
  tests, in a hook or a helper of the file. An assertion added, moved within its test or indented
  otherwise isn't marked; one moved to another test marks the test it left.
- A test file the guard can't parse, on either side, and a report of `main`'s run that is missing
  or gave no tests.
- `checks.json`, `.oxlintrc.json`, `package.json` or a workflow whose copy on `main` the guard can't
  read, so that it has nothing to compare the branch's with.

A new sign goes into `scripts/guard/` (`signs.ts`, or `assertions.ts` and `tests.ts` for what the
tests assert and which of them ran, `stylesheets.ts` for what counts as a raw value in a stylesheet) with its tests and into this list, in one PR, which
the guard marks as any change to it. The list is never whole, and isn't meant to be:
the guard is a tripwire for the cheap, known ways around a check, and the reviews catch the rest.
A way around that a review finds goes into [What it doesn't see](#what-it-doesnt-see); it joins
the list through the retro ([The retro](#the-retro)), once it has been met in a PR or
costs one line.

### What a marked PR needs

Nothing from the guard: it holds no PR, and its `guard` job passes whatever it marks, so a mark
emails no one, as a failed run or a comment on the PR would. The deputy's round judges every mark
(the `deputy` skill → The round), and the retro reads what it accepted ([The retro](#the-retro)).

Until 2026-11-15 the marks were approved one by one: the owner's list by the owner, the design
values by the coordinator, the changes to existing checks by a second review in a fresh session,
each with a record on the PR, which the guard read from the PR's comments and held the PR red
without (#366, until #439: its comment and its failed runs emailed the owner on every push of a
marked PR).

**When the guard itself is broken.** The `main` ruleset has no bypass for anyone. With `guard`
among its required checks, a `guard` job that fails by itself (an error in the script, not a
mark) stops every PR, and the one way out is the owner's: taking
`guard` out of the required checks in the repository's settings until the fix is merged.

### The thresholds and the exclusion lists

They sit in `checks.json`, as data, so that the guard compares them exactly: `vite.config.ts` reads
from it what coverage measures and its thresholds, `stryker.config.mjs` the mutators and the tests left out,
`scripts/mutants.mjs` the folders mutated and the files in them that aren't production code,
`scripts/size/size.ts` the size budgets (`budgets.size`, [The size budget](#the-size-budget)), the
requests tests the requests budgets (`budgets.requests` for the screens' openings and
`budgets.journeys` for the moves between them, [The requests budget](#the-requests-budget)), the
layout shift test the layout shift budgets (`budgets.layoutShift`, a score per window size and
screen, and the ceiling over them, `budgets.layoutShiftCeiling`, `docs/TESTING.md` → The layout
shift test), and the screenshot tests the accessibility budgets and the tags axe checks
(`budgets.accessibility` and `budgets.accessibilityTags`, [The accessibility budget](#the-accessibility-budget)) and how far a pixel may drift from its baseline (`budgets.screenshotThreshold`, `docs/TESTING.md` → Screenshot tests). A new
threshold, budget or exclusion list goes there too, not into the config that uses it, where the
guard wouldn't see it move.

### How it runs

**In CI** the `guard` job runs on every PR (`.github/workflows/guard.yml`). It runs `main`'s copy of
the script, not the branch's, so a PR that changes `scripts/guard/` is still read by the guard it
found. The script reads the branch through git and runs none of its code; the parsers it needs
(oxc's, which comes with Vite, for test files, PostCSS for stylesheets, `yaml` for workflows) are
installed from `main`'s lockfile. The workflow file is
another matter: on `pull_request` GitHub runs it as the PR has it, so a PR that changes `guard.yml`
runs its changed steps, and what `main`'s script does about it is mark the change as a weakening.
What the guard finds goes into the job's summary and into the PR's `guard report` check, a check
run the job writes on the PR's head on every run, green, with the report as its summary (cut,
with a note, where it is longer than a check's summary holds), since the reviews read the report
through the API, which has no way to a job's summary. The check's `output.text` holds the same marks as
JSON for a reader that isn't a person (the quality system's planned dashboard collector): `schema` 1,
the full `head` commit and `base`, the commit the branch left `main` at (as the report's "against `main` at"), `total`, `counts` per kind and `cut`, and `marks`, one per mark in the report's order, each
with its `kind` (`weakens-checks`, `design-value` or `existing-check`, the report's three lists), its `file`
and `line` where it has them, and the `detail` the report's line gives, an old and a new value in it where
there is one. It is cut to what a check's text holds (`SUMMARY_LIMIT` in `scripts/guard/signs.ts`) by leaving out the last marks, never mid-JSON, with `cut` true and
`total` the whole count. The job itself, `guard`, is what `main`'s
ruleset requires: it passes once the guard has run and written its report, and a failure to write
it, such as an error from GitHub's API, goes away with a re-run of the job. A fork's PR gets a read-only token, so the
job writes it no `guard report` check, which nothing requires, and the job's summary alone has
the report.

The lists of the tests that ran come from a job of their own, `tests`, which the `guard` job waits
for. It installs and runs both sides, the commit the branch left `main` at and the branch's head:
the Vitest tests with the JSON reporter, since only a run has a table's every row as a test and
knows a skipped one, and Playwright's `--list` for the screenshot tests, the smoke journeys,
the WebUI's smoke journeys and the requests test (on a side that has its config), which needs no browser. A failing test is still a test that ran; CI's own jobs fail for it. The
branch's code runs in that job, so its token can only read. What that code can still write is the
job's artifact and the Actions cache in the PR's scope: the `guard` job takes the artifact, the
reports with their paths cut to start at the repository's root, as data to `main`'s script (one it
can't read is one that gave no tests), and takes nothing from the cache, since a cache saved there
could overwrite `main`'s script where the token can write. When the job fails or a report is
missing, the guard still runs and says which report of which side it lacks.

**Locally** `npm run guard` prints the same report for this checkout's commits against
`origin/main` (`--base` and `--head` name others), so the author sees the marks before pushing. It
reads commits, not the working tree, and says so when there are uncommitted changes. It doesn't
compare the tests that ran, and says so: that takes a run of each side, which CI makes
(`--tests-base` and `--tests-head` name two folders of such reports, for one made by hand).

### What it doesn't see

- A check weakened from inside: a config that stops reading `checks.json`.
- A test that checks less with its assertions left as they were written: what it sets up before
  them changed (a fixture, a mock, the input), a helper or a matcher made looser where it is
  defined, in another file; a table the guard can't open, imported or computed, whose rows
  changed; a query that throws when nothing matches, used as a check without `expect`
  (`screen.getByRole('button')` on a line of its own), rewritten or removed.
- What a test asserts when the same change renames it: the test is marked as gone or renamed,
  among the changes to existing checks, and its assertions aren't compared.
- An assertion that only moved to another line of its chain (`expect(a)` and `.toBe(1)` on two
  lines) is marked, though nothing changed: the guard compares the text with its spaces
  collapsed, not the meaning.
- The tests that ran, when the branch changes what a run reports: the lists come from a run of
  the branch's own code under its own config.
- A trigger narrowed in a workflow other than by a new path filter (a branch or an event removed,
  a path taken out of an existing filter).
- Other spellings of what it marks, known and left out: Vitest's `it.fails`, and a modifier
  before the condition (`it.concurrent.skipIf`); Playwright's `--update-snapshots` in a command
  CI runs; `retries` as the last word of its line (a last property without a comma), `retry`
  passed on by its name (`{ retry }`, `const retry = 3`), and a retry behind a name the patterns
  don't read (`repeats`, a helper that retries); `set +o errexit`, `set +eu`, `|| echo` and other
  commands that end well after a failure; `--no-verify`-like flags of the tools; a check dropped
  from an npm script that still exists (the script changed, which is marked among the changes to existing checks).
- A tracked file named in `.gitignore`: oxlint skips what git ignores, so the path is taken out
  of the lint from a third file, beside `ignorePatterns` and the lint ignore files.
- A removed step of plain shell, with no npm script, npx tool, node script, docker command or
  action in it (`curl` against a server, a shell test): it is marked among the changes to existing
  checks, not as a weakening. So does a check dropped from a step whose commands all stay.
- An action's inputs (`with:`) and a step's other keys but `if:` and `continue-on-error:` (`env:`,
  `working-directory:`): a change to them isn't read, so a check an input turns off
  (`fail-on-error: false`) is marked nowhere.
- In reading a workflow's commands: a flag with a value before an npm script (`npm --prefix
  tmdb-proxy run test`) is read as the script, and one before docker's subcommand (`docker
  --context ci run`) as the subcommand; `node` with a flag first (`node --test server`) isn't
  read as a command; a command that goes on on the next line (`docker \` and then `run`) is
  read as two lines: docker and npm read no command there, so the step, removed, is a change to an
  existing check, while npx and node read `npx \` and `node \`, which are weakenings under that name;
  an image used as an action (`uses: docker://alpine:3.20`) is another action after its tag
  moves.
- A command's word in a step's message is marked, though it runs nothing: `echo "the docker image
  is ready"` reads as `docker image`, and removing that step is marked as a weakening. The guard reads
  the words wherever they stand rather than work out where a command starts.
- A key in `checks.json` with a dot in its name (`"size.js"` under `budgets`, `"thresholds.lines"`
  under `coverage`, or a key that is empty): the guard joins the keys of a path with dots, so such a
  key lands on the same path as the real one and hides what the real one did, a budget raised or a
  threshold lowered.
- What a command built by an expression runs: the guard reads `run: npm run ${{ matrix.script }}`
  as written, so a script taken out of the matrix, or an input's default changed, isn't read as a
  command no longer run.
- Where its reading of a step's shell comments differs from bash's. The reader knows only quotes
  (`'…'`, `"…"` with its backslash escapes), a backslash outside them and where a word starts (after
  a space, a tab, a newline or one of `;&|()<>`), and bash's rules alone, for every step, also one
  that runs in another shell (pwsh escapes with a backtick, cmd has no `#` comments), and it reads
  a folded block after YAML has joined its lines. Wherever a `#` or a quote meets anything else of
  the shell, it reads otherwise than bash: a substitution of any kind (`$(…)`, `$((…))`, `<(…)`,
  backticks), `[[ … ]]`, an extglob, `$'…'`, a heredoc, a quote nested in a substitution
  (`"$(echo 'a"b')"`), and a line inside a multi-line quote whose `#` comes first or after spaces
  and tabs only, which the line rule cuts with the closing quote on it. None of these leaves a quote
  open or meets a `#` in the workflows today, whose commands read the same with both readers.
  Wherever it reads otherwise than the shell that runs the step, a quote read as open where that
  shell has closed it (a `#` after it read as text, so a command commented out there reads as still
  run) or a `#` read as a comment's start where that shell reads on (`tag=$(git describe)#ci && npm
  run lint` in bash, `npm test # && npm run lint` in cmd: the rest of the line is read on neither
  side, so a command dropped from it isn't marked), it may also catch less than `main`'s line by
  line reader, which cut every line whose first character but JavaScript's blanks was `#` and read
  every other line whole. So does a line that starts with another of JavaScript's blanks before its
  `#` (a no-break space, `\v`, `\f`, `\r`): `main` cut it, this reader reads it as bash does, a
  command, so a command after the `#` on it reads as still run.
- A change to `guard.yml` that stops the script from running or from being `main`'s copy: the
  workflow runs as the PR has it, so the weakening's mark comes from the changed steps, if they
  still make it.
- A green `guard` reported by another workflow of the PR. GitHub's Free plan has no way to
  require that a check come from `main`'s copy of a workflow, and the guard marks a job or a
  status of its name as a weakening by one pattern, no more.
- Anything written on purpose to get past it. The authors' sessions all work under one GitHub
  account, so the guard protects against forgetting, not against forging.

Those are the reviews' to catch (`TESTING.md` → Reviewing a PR's tests).

### Its own tests

They sit next to it: the signs as pure functions in `scripts/guard/signs.test.ts`, the reading of
a test file in `assertions.test.ts`, and the comparison of the tests that ran in `tests.test.ts` (layer 1), the reading of a branch and of the reports' folders in `scripts/guard/guard.test.ts`,
over a git repository made in the test (layer 4). Stryker mutates the guard as it does the app's
code.

## The size budget

A change can make the app heavier without a line that says so: a new dependency, an import that
pulls in a whole library, an asset. The size budget makes that a failing check. After
`npm run build`, `npm run size` (`scripts/size/`) sums the files in `dist/` by kind and compares
each sum with its budget in `checks.json`:

| Kind | Counted | Budget |
| --- | --- | --- |
| JS (`.js`, `.mjs`), with one language's texts | gzipped, at gzip's default level | `budgets.size.js` |
| CSS | gzipped, the same way | `budgets.size.css` |
| Everything else | as it is | `budgets.size.rest` |

Each language's texts are a file of their own, `assets/language-<code>-<hash>.js`
(`chunkFileName` in `vite.config.ts`), and a page loads only the one it shows (#492), so JS counts
only the heaviest of them (`isLanguageFile` in `budget.ts`) and the report names the files it left
out. A language file named otherwise counts as any JS, so a broken name shows as JS over its budget.

gzip is a steady measure of the text rather than the bytes a browser gets: `server/static.ts` sends
Brotli to a browser that takes it and gzip only to one that doesn't. The rest is mostly fonts and
icons, compressed already; its few text files (`index.html`, the manifest, `favicon.svg`,
`version.json`, about 6 kB) count as they are, though the server compresses those over 1 kB.

The sums are per kind rather than per file, since the files' names carry hashes that change with
their content. Each budget is a whole number of bytes, about 5% above what the build measured when
it was set: on 2026-11-12, 186,937 bytes of JS, 15,392 of CSS and 184,330 of the rest, against
budgets of 196,300, 16,200 and 193,600. JS's was lowered to 191,100 on 2026-11-20, to the
measurement of 191,003 bytes rounded up to the next 100, when the languages' texts left the main bundle (#492). Clean builds in a row gave the same numbers to the byte,
and CI's build on Node 22 the same as a local one on Node 24: the size is exact, so the margin is
room for ordinary changes, not for noise. It is exact for the dependencies `package-lock.json`
names: a local `node_modules` that drifted from it builds another size, so measure after `npm ci`.
It went to 193,700 the same day, the measurement of 193,602 bytes rounded up the same way, on the
coordinator's decision on #486 (Telegram notifications, which add 2,599 bytes with one language's
texts), so like the budget before it, it leaves no margin. It went to 196,300 on the same day, the
measurement of 196,210 bytes rounded up the same way, on the coordinator's decision on #481 (push
notifications, which add 2,514 bytes: the push card and its browser module in the main bundle, the
service worker's push handlers, and one language's texts, with the fixes of its review's first
round), leaving no margin either. It went to 196,600 on 2026-11-21, the measurement of 196,557 bytes rounded up the same way, on the coordinator's decision on #510 (the releases screen setting Prowlarr up in a sheet, 336 bytes with one language's texts), leaving no margin either. It went to 197,500 on 2026-11-21, the measurement of 197,422 bytes rounded up the same way, on the coordinator's decision on #508 (a failed connection naming its cause: 826 bytes, 432 of them one language's texts, after the texts were shortened and the review's round 1 asked for more in them), leaving 78 bytes. It went to 198,400 on 2026-11-21, the measurement of 198,351 bytes rounded up the same way, on the coordinator's decision on #509 (hints for Kinopeer in a container: 929 bytes, 353 of them one language's texts). Review's rounds 1 to 3 brought it to 198,398 bytes, the sentence two texts share nested as the conventions ask, though that's heavier than repeating it, and the bypass hint's Russian text cut down to fit once it led with setting a password. It went to 198,500 on 2026-11-21, the measurement of 198,408 bytes rounded up the same way, on the coordinator's rule for the milestone, after review's round 4 had both forms take the localhost hint back as another address is typed (10 bytes, with no text left to cut), leaving 92 bytes. It went to 198,900 on 2026-11-21, the measurement of 198,859 bytes rounded up the same way, on the coordinator's rule for the milestone, for #511 (Find under the forms' address fields: 451 bytes with one language's texts, after its texts were shortened, with the text for a failed look review's round 1 asked for), leaving 41 bytes. Review's rounds 2 and 3 brought it to 198,887 bytes, a look that got no answer from Kinopeer's server saying the existing text for Kinopeer not answering, leaving 13 bytes. It went to 199,200 on 2026-11-22, the measurement of 199,124 bytes rounded up the same way, on the coordinator's decision on #500 (Settings' saves that outlive their sheet, `src/logic/saves.ts` and `src/lib/useSaves.ts`, with the qBittorrent folders sheet moved onto them: 344 bytes over `main`'s 198,780, with no text added; the folders sheet's own in-flight state that went covers part of it, and the other three sheets' own, which go in the PRs after it, can't be counted before they move), leaving 76 bytes. It went to 199,400 on 2026-11-22, the PR's first measurement of 199,368 bytes rounded up the same way, on the same decision, for Telegram's form moved onto those saves (34 of its bytes one language's texts: the toasts that say a request whose sheet was closed, naming the bot, the chat or Telegram's notifications; the form's own in-flight state that went covers part of the rest). Review's round 1, which has the sheet opened again at the step that sent the request, with the chat being saved shown (no new text), brought it to 199,451 bytes, 327 over `main`'s 199,124, and the budget to 199,500, rounded up the same way, leaving 49. It went to 199,900 on 2026-11-22, the measurement of 199,809 bytes rounded up the same way, on the same decision, for qBittorrent's and Prowlarr's connection forms moved onto those saves (358 bytes over `main`'s 199,451, 40 of them one language's texts: the toasts that say a check whose form is gone, naming the connection; the forms' own in-flight state that went covers part of the rest), leaving 91. Review's round 1, which has a form opened again run its own caller's next step and a form that's gone say in a toast what the form would have said for each refusal, through one function per form that words each failure for the form and the toast alike (one new text, qBittorrent refusing the login, 58 bytes of one language's texts), brought it to 199,974 bytes, 523 over `main`'s 199,451, and the budget to 200,000, rounded up the same way; round 2 to 199,975, leaving 25. It went to 200,200 on 2026-11-22, the measurement of 200,139 bytes rounded up the same way, on the same decision, for the push card's actions moved onto those saves (164 bytes over `main`'s 199,975, with two texts: push turned on, and a failure naming push notifications, for the toasts that say an action whose card is gone; the card's own in-flight state that went covers part of the rest), leaving 61. It went to 200,300 on 2026-11-22, the measurement of 200,269 bytes rounded up the same way, on the owner's decision, for i18next 27.1 in the monthly npm update (130 bytes over `main`'s 200,139, all of them i18next's: a missing plural form now falls back to the same language's `_other`, which Kinopeer's texts, with every form, don't need, and `t()` skips its interpolation scans for a text without them), leaving 31. It went to 200,400 on 2026-11-22, the measurement of 200,365 bytes rounded up the same way, on the coordinator's decision on #545 (the page's shared answers followed by the callers that show them, so Settings opened again shows a save from an earlier visit: 68 bytes over `main`'s 200,297 at #549, as CI's `performance` job measured it, with no text added; Settings' own copy of the server's settings that went, and its writes of what the client keeps itself, cover part of it), leaving 35. It went to 200,500 on 2026-11-22, the measurement of 200,446 bytes rounded up the same way, on the coordinator's decision on #554 (#553: Fix match's search and Search's next page saying when Kinopeer's server didn't answer, 200,394 with Fix match reusing `TmdbFailedState`, 53 bytes less than a state of its own, and Search's banner keeping its title, 12 less; then review's round 1 found that on a phone Fix match's Enter key and Open again leave Downloads while `holdPage` keeps the window a pixel from the top, so the screen saved that pixel as its scroll, and `useScrollRestoration` now adds back the body's margin `holdPage` stands in for the offset with, 52 bytes. Rejected: `holdPage` exporting its held position for `useScrollRestoration` to read, 116 bytes; Fix match's state without Enter key and Open again, so nothing leaves the page, 80 bytes, which loses what #553 asks for and leaves the case for the next modal with a field and a link), leaving 54. It went to 200,600 on 2026-11-22, the measurement of 200,519 bytes rounded up the same way, on the coordinator's decision on #566 (Settings' Prowlarr, TMDB and Telegram rows and the releases' error state saying when Kinopeer's server didn't answer, 73 bytes over `main`'s 200,446, with no text added: the rows share one function, and the releases reuse `UnreachableState`. Tried: one `t()` call over the picked key, 8 bytes more; a `_kinopeer` context for each service's text, 8 more and three nested texts; `useReleases` always reading `unreachable`, even with no error, 2 less, not worth a field that says something without one), leaving 81. Review's round 1, which has the add sheet's failed fetch of the torrent say so too, with the existing text for Kinopeer not answering, brought it to 200,548 bytes, leaving 52. It went to 200,900 on 2026-11-23, the measurement of 200,858 bytes rounded up the same way, on the coordinator's decision on #581 (a title whose original isn't in Latin or Cyrillic script also searched by its English name: 282 bytes over `main`'s 200,576, with no text added, the script check, the second query, the merge of the two searches and the English details' shared request. Tried: the merge's identity as one chain of fallbacks, without a magnet link's step, 24 bytes less; the merge leaving each search's own list as Prowlarr gave it, which the screenshot tests' releases sharing one link showed it didn't, 6 more), leaving 42. It went to 201,000 on 2026-11-23, the measurement of 200,941 bytes rounded up the same way, on the coordinator's decision on #579 (Remove limits in the Speed limits sheet: 48 bytes over `main`'s 200,893 at #589, 7 of them one language's texts. Tried: the button's `type`, which `Button` defaults to `button`, 5 bytes less, kept out; leaving out `block`, 1 byte less, not worth it), leaving 59. Review's round 1, which has the merge go by the guid rather than the download link and Try again ask TMDB for the English name again, brought it to 200,859 bytes, leaving 41. Round 2, which has the merge go by the indexer too, Try again after a failed English name start a new search rather than show the last one's outcome while it's on its way, and the filters picked for a title last through it, brought it to 200,894 bytes, and `main` brought in at #588 (200,579) to 200,893, 314 over it, leaving 7.

**In CI** it is the step after `npm run build` in the `performance` job, which adds a table of the kinds,
their sizes, budgets and what is left to the job's summary, and records the sizes as actual values
before its verdict ([The actual values](#the-actual-values)). It fails over a budget, and also when
it can't check: a `dist/` that is missing, a build without a file of each kind (cut short, or
with files named in a way it doesn't read, such as `.cjs`), an entry in `dist/` that is neither a
file nor a folder (a symlink, which the server would still serve), a `checks.json` it can't read, a
budget that is missing or not a whole number of bytes above 0. It takes no arguments, so the
budgets come from `checks.json` alone, where the guard compares them. A failure names the kind that
grew, by how much it is over, and its three heaviest files.

**Over a budget**, find what grew: build `main` and the branch, each after `npm ci`, run
`npm run size` on each and compare the files of that kind; then make it smaller or leave it out. Raising a budget to get a PR
through is a weakening: the checks guard marks a budget raised, removed or no longer a number, and
the deputy accepts it only with the measurement and why it can't be met otherwise. A new budget is
judged in the deputy's round too. A budget
lowered, after the app got lighter, needs no record.

**Its tests**: the rules (the kind of a file, the budgets read, the verdict and its report) are
pure functions in `scripts/size/budget.ts`, tested in `budget.test.ts` (layer 1); reading a build
folder and `checks.json` in `size.ts`, tested in `size.test.ts` over a folder made in the test
(layer 4). Coverage measures the folder and Stryker mutates it, as it does the guard.

## The requests budget

A change can make a screen ask the servers for more without a line that says so: a hook that
fetches what another already has, a lookup for something the screen doesn't show, a second copy of
a request. The requests budget makes that a failing check. `npm run test:requests`, after
`npm run build` (`playwright.performance.config.ts`, `e2e/performance/requests.perf.ts`), opens
each screen afresh by its address in Chromium, with every server route mocked as in the screenshot
tests (`e2e/app.ts`), and counts the requests it sends to each of Kinopeer's routes (`/qbt`,
`/tmdb`, `/tmdb-img`, `/prowlarr`, `/api`), to the app's own origin outside them (`other paths`)
and to any other origin (`other origins`). The app's own files aren't counted: the page itself (a
request the browser makes as a document, which the server answers with `index.html`) and every
file of the build, which the test lists from `dist/` (its scripts and styles, the fonts, the icons,
the manifest, `version.json`). Anything else on the app's origin is `other paths`, whose budget is
0 on every screen: a server route the list above doesn't name (`/healthz`, or a new one, which then
gets a key of its own) or a file the build doesn't have. `other origins` is 0 on every screen too,
and it sees only what leaves the page: the Content-Security-Policy `vite preview` sends blocks a
request to another origin before it goes out (the smoke journeys fail on that, `e2e/smoke/test.ts`),
so its 0 catches such a call only with the policy loosened for it, and WebSockets, which the app
opens none of, aren't requests and aren't counted.

The screens are those the screenshot tests open by their address: Downloads, a torrent, Search
without a query (its rows of titles), with one and with one and a year (which searches movies and
series apart), a movie's page, a series' page, its releases and Settings, each on a phone (the config's 390×844) and on desktop (`DESKTOP`, 1440×900). The
screenshot tests also open other states of these: other torrents' pages (`/torrent/a2`, `a4`, `a8`,
`b1`), a search that finds nothing (`/search?q=zzz`) and onboarding (`/` with qBittorrent or TMDB
not set up). They're left out: each is a screen counted here in a state the shared fixtures' options
set up, whose count would follow those options more than the app. Their budgets sit in
`checks.json` under `budgets.requests`, by window size, screen and key, every key of every screen,
0 included. The test sets its own three torrents, so a change to the shared fixtures for a
screenshot doesn't move a budget; the titles, releases and posters come from the shared fixtures.

**Moves between screens.** A screen can also cost more when it's reached from another than when
it's opened by its address: a request for what the screen before it already had, a poll started
again. `e2e/performance/journeys.perf.ts`, in the same config and the same `npm run test:requests`,
makes short journeys, each a test, in both window sizes: one screen opened afresh by its address,
then up to three moves made the way a person makes them (a click on a row, a link, a button or a
tab found by its role and name, a query put into the search box as one input, the browser's Back;
never loading an address after the first screen), and counts each move's requests by the same keys. The journeys:

- **A download**: Downloads, a torrent's row (its page on a phone, its drawer on desktop), Back,
  the same row again.
- **Finding a title**: Search without a query, a query put in (one input, as a paste or a
  keyboard's suggestion gives it: typed key by key with no pause between, the field loses a key
  now and then, the app's own bug, and the search finds something else), a title found, Back to the
  results kept.
- **A title's releases**: a series' page, Find releases (a screen of their own on a phone, the
  title page with them under the hero on desktop), then back: the browser's Back on a phone; on
  desktop the page's own Back, since the releases replace the title's history entry there and the
  browser's Back would leave a page opened by its address, while the page's Back goes to Search.
- **The tabs**: Downloads, Search, Settings, Downloads (the tab bar on a phone, the sidebar on
  desktop).

Eleven moves in each window size. A move's budget sits under `budgets.journeys` by window size,
then by the move's name, its journey and its place in it (`download.2-back`), since the same move
costs differently after another path, then by key, every key, 0 included. The opening at a
journey's start isn't counted here: `requests.perf.ts` counts it. After each move, as after an
opening, the page has to show the screen meant (its heading by role, level and name, a control only
its loaded content has where that heading stays above an empty or "not answering" state, no dialog
left open unless the screen is the torrent's drawer, and the address the move ends at, which tells
apart a torrent's page and its title's on a phone, both headed by the title). The journeys'
torrents are all tagged with their title, so no title is guessed and saved a second later: that
save would be counted in some later move, or in none after the last.
Nothing that changes something (adding a release, pausing, deleting) and no sheet or menu left open
is a move here.

**Exact, not within a margin.** The app polls qBittorrent every 2 s and a torrent's files every
3 s, so a count over real time grows with how long the run takes. The test pauses the page's clock
(`page.clock`) before the page loads and runs it for 1 ms less than the shortest of the app's poll
intervals, which it reads from `src/torrents/pollIntervals.ts` (a module that imports nothing, so
the test imports it by its path): the timers a screen's open sets off fire (the save of a guessed
title a second later), and no poll repeats. The clock runs in steps of 100 ms, with the page left
to settle after each (no request in flight for 250 ms of real time), so a timer set after an answer
fires in order; a page that hasn't settled in 10 s fails the test, naming the requests still in
flight. A journey shares that run equally between its opening and its moves (`clockShare`: four
parts of 1,999 ms are 499 ms each, which covers the search's 350 ms wait after a query), so no poll
repeats anywhere in it and a move's count is what the move asks; a move's requests are counted only
once the page has settled from the part before it. A journey whose share would be shorter than one
step of the clock fails rather than runs. A timer the app sets for longer than a share fires in a
later part: one the screen's loaded content waits for (the search's wait) fails the move, which
then lacks that content; any other (a save a second later) has its request counted in a later move,
with every check passing, or in none after the last move. So a new journey or move looks for such
timers first: what it sets off after a share is either taken out of the journey (as the guessed
title is, by tagging every torrent) or left to the openings' test, which runs the whole 1,999 ms.
The page then has to show the screen's own heading (by its role, level and name), so a
crash or another screen isn't counted as the screen. Where that heading stays above a "not
answering" or empty state (Downloads, Search, the releases), it also has to show a control only the
loaded content has (a torrent's row, a found title, a release's Add button). On a title's page and
a torrent's, the heading is the name TMDB gave, and a service that didn't answer shows in the
counts (the title pages) or takes the heading away (the torrent's page). Settings asks the same
whatever the services answer, since it shows what each check got back, so its count is its own in
either state. The test starts its own server on port 4174
every run and fails when the port is taken, since a server already there may serve another build.
Twenty runs in a row gave the same counts, locally and in CI, for the openings and the moves
alike, so the budget is each count itself: a count above its budget fails, and so does one below it, since a budget left higher
than the screen needs would let a request come back unnoticed.

**What fails**: a count that isn't its budget; a screen the test opens or a move it makes without a
budget, or a budget for a screen it doesn't open or a move it doesn't make; `budgets.requests` or
`budgets.journeys` that can't be read (not an object, a count that isn't a whole number of 0 or
more, a key missing or one the check doesn't count); a journey whose share of the clock is shorter
than one step;
`src/torrents/pollIntervals.ts` exporting no interval, one not named `…_INTERVAL_MS` or one that
isn't a whole number of milliseconds above 1 (the clock's run would be wrong); a page that doesn't
settle; a screen whose heading or loaded content doesn't show, after an opening or a move. A
failure names the screen or the move (and where it led), the window size and the route, the budget
and the count, lists that route's requests and says what to do; a journey judges every move before
it fails, so one failure names each move off its budget.

**Posters.** A poster's count is the posters the page hasn't loaded before: one it loaded once
isn't asked for again, as the HTTP cache and the service worker give in production. The tests block
the service worker, and Playwright's routes turn the HTTP cache off, so a poster shown again would
otherwise come from Chromium's memory of the document's images only while no garbage collection had
dropped it, and whether one had would move the count from run to run. So `holdForCounting`
(`e2e/performance/page.ts`) keeps every image the page loads in memory for as long as the page lives
(a script added before the page's own, holding each `<img>` once it loads), and `runClock` has
Chromium collect the page's garbage (through the DevTools protocol) as each part starts, while its
requests are in flight, and after every step of the clock, so a count never rests on a collection
not having happened. It's the same for the openings and the moves. Every TMDB image the app shows
is an `<img>`: an image put in another way (a CSS background, a preload) wouldn't be kept, and a
new one is checked here first. Without the kept images and with the collections, six of the eight
journeys fail on a poster asked for again. The collections add under a twentieth to the run
(twenty runs in CI took 27.4 min with them, 26.2 min before). Should a Chromium update stop the kept images from keeping a poster in its memory, the fallback is a rule in
the counting: a poster's address counts once per journey, whatever the page asks.

**What it doesn't count.** Moves that change something and the sheets and menus a screen opens are
left out of this budget for now.

**Over a budget**, find what sends the new request (the failure lists them; the trace in the
report shows when each went out) and take it out. Raising a budget to get a PR through is a
weakening: the checks guard marks a budget raised, removed or no longer a number, and the deputy
accepts it only with the measurement and why it can't be met otherwise. **Under a budget**, lower it in `checks.json` to the new count: a
budget lowered needs nothing. A new budget, for a new screen or a new move, is judged in the deputy's round.

**In CI** it is the step after the size budget's in the `performance` job, on the same build,
in the Playwright image the screenshot tests run in, pinned by the same digest, as the `smoke` job is; the reporter `e2e/performance/summary.ts` adds the
tables of the counts, the openings' and the moves', to the job's summary, and a failure uploads the Playwright report with its
traces. The counts and the layout shifts are also recorded as actual values ([The actual values](#the-actual-values)).

**Its tests**: the rules (which key a request counts against, the budgets read, the screens and
moves without a budget, the verdict and its report, the table, the clock's run from the intervals
and a journey's share of it) are pure functions in `scripts/requests/budget.ts`, the same for the
openings and the moves (`OPENINGS` and `JOURNEYS` say where each one's budgets sit and how its
messages name them), tested in `budget.test.ts` (layer 1); coverage measures the folder and Stryker
mutates it. What both browser tests do with the page (record its requests, hold and run its clock,
keep its images and collect its garbage, wait for it to settle) is in `e2e/performance/page.ts`. The browser tests only collect the numbers; they are layer 6, tests of their own
beside the screenshot tests and the smoke journeys (`docs/TESTING.md` → Layers).

## The layout shift budget

A change can make a screen jump as it loads without a line that says so: a block that comes in
with a late answer above what is already on the screen, a loading state that doesn't keep the
loaded page's place. The layout shift budget makes that a failing check. The test that reads it,
how it lets a screen's answers land and which screens and states it reads are in
[TESTING.md → The layout shift test](TESTING.md#the-layout-shift-test).

**Each screen has its own budget**, by window size, under `budgets.layoutShift` in `checks.json`
(`phone.torrent`, `desktop.torrent`): the highest reading among the screen's cases and both orders, rounded up to
0.01, so a screen that reads 0 gets 0.01, from CI's readings. The readings are exact (the same
number to the fourth digit every run, locally and in CI), so the budget is the screen as it is, with room only for the rounding: a new
shift on a screen that barely moved fails, rather than hiding under a budget set for the screen
that moves most. Decided on 2026-11-13, in place of one bound of 0.1 for all (SPEC's decision log).

**The ceiling.** No budget is over `budgets.layoutShiftCeiling` in `checks.json`, 0.1, the bound
Web Vitals call good: `readBudgets` (`scripts/layout-shift/budget.ts`) refuses one, saying so, and
fails when the ceiling is missing or not a number over 0. A screen that moves more has a bug to
fix, not a budget to raise; until it is fixed, the state that moves is left out of the test with
its issue named (TESTING → What it leaves out). A budget under the ceiling can still carry a known
jump, its issue named beside it in TESTING, and the fix lowers it; none carries one today (the
releases at `desktop-rail` and `desktop-1280` did until #400). A budget is one number for both
orders of a screen, so where a carried jump shows in one order only, a new jump as large passes in
the other.

**What fails**: a reading over its budget, which names each shift with the elements that moved and
their boxes before and after; a screen of the list without a case or a budget, or a budget for a
screen the test doesn't read; `budgets.layoutShift` that can't be read (not an object, a budget
that isn't a number of 0 or more, one over the ceiling, a ceiling missing or not over 0); a request the case doesn't name; a chain
the page doesn't follow.

**Over a budget**, find what moves (the failure names the elements) and keep it in place or keep
room for what loads later. Raising a budget is a weakening: the checks guard marks a budget
raised, removed or no longer a number, and the deputy accepts it only with the measurement and why
it can't be met otherwise. A new budget, for a new screen, is judged in the deputy's round. **Under a budget** by a step of 0.01 or more, after a fix,
lower it in the same PR: a budget lowered needs nothing. The ceiling is in `checks.json` beside
the budgets, so the checks guard marks it raised as it does a budget.

## The accessibility budget

A change can make the app harder to use without a screen reader, a keyboard or good eyes, and look
the same: a button whose name doesn't say what it shows, text a shade too faint on its background,
a control squeezed under another. The accessibility budget makes a new one a failing check. Every
screenshot the screenshot tests take (`e2e/*.spec.ts`, `docs/TESTING.md` → Screenshot tests) also
has axe (`@axe-core/playwright`) read the state it shows, and the count of elements that break each
of axe's rules there is held to its budget.

**What axe reads.** The rules of WCAG 2.2 AA as axe checks them: the tags in
`budgets.accessibilityTags` (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). A rule axe
can't decide on an element (text over an image, say) is "incomplete" and isn't counted. axe skips
a tag none of its rules has without a word, so the read fails on one (`wcag22AA`) rather than read
nothing for it. axe's
`target-size` asks for 24px; the 44px of `CLAUDE.md` → Conventions has no check of its own and stays
the reviews' (decided on 2026-11-14: a check of its own would need exceptions, such as links in
text, for little gain). axe reads the whole page, also for a screenshot of one element, and after
the screenshot, so nothing it does on the page shows in it.

**Built into the screenshot.** The specs take `test` and `expect` from `e2e/test.ts`, whose
`toHaveScreenshot` takes the screenshot and then has axe read the page, as do those of the
`expect`s it makes (`expect.soft`, `expect.configure`, `expect.extend`) and of `test.expect`, also
on a `test` that `test.extend` makes; oxlint refuses `test`, `expect`, `mergeExpects` and the
default export from `@playwright/test` and from `playwright/test`, the package it re-exports, in
every file under `e2e/` but `e2e/test.ts` itself and the smoke and performance tests, which take no
compared screenshot (`.oxlintrc.json`): the specs and the modules they share steps from (`app.ts`)
alike. So a new screenshot can't be taken without the read, which a helper called beside it would
leave to whoever writes the test. Under `expect.soft` the read's verdict is soft too, so the test
goes on to its later screenshots.

**Each state has its budgets**, under `budgets.accessibility` in `checks.json`: by spec (its file
without `.spec.ts`), then screenshot (its name without `.png`), then axe's rule, the count of
elements that break the rule there (`downloads.select-list-dark-ru.color-contrast`). A rule a state
doesn't name is 0, and a state where axe finds nothing has `{}`. Two tests that take the same
screenshot share its budgets, as they share its baseline. A screenshot's name has no dot but its
`.png`, nor has its spec's but its `.spec.ts`: the checks guard reads a budget by its keys joined
with dots ([What it doesn't see](#what-it-doesnt-see)).

**Exact, not within a margin.** The tests run on mocked answers with the clock frozen, so a state
is the same every run, and so is what axe finds in it: four whole runs in a row in Docker gave the
same counts in every state, and CI's run the same as Docker's on a Mac (the same image, at #410's
first head). So the
budget is the count itself, as the requests budget's is: a count above its budget fails, and so does
one below it, since a budget left higher than the state needs would let a broken element come back
unnoticed. A fix lowers its budget in the same PR, to 0 rather than out of the file: the checks
guard marks a budget removed.

**The violations found at the start**, by #410's first read, each rule with its issue, went into the
budgets as they were found, and their fixes lower them to 0 (decided on 2026-11-14: fixing them
first would turn the step into design work, and a visible fix is the owner's):

| Rule | Elements, states | What a fix changes | Issue |
| --- | --- | --- | --- |
| `label-content-name-mismatch` | 44 in 44: Downloads' status button on desktop, the phone's sort button with a type filter, the torrent's category row, a torrent in a title's "In downloads" | Nothing on the screen: the accessible names. Fixed, its budgets 0 | #407 |
| `color-contrast` | 11 in 3: secondary text on a selected torrent, on a phone and in the desktop table, and on a skipped file | The colors, so the owner's. Fixed, its budgets 0 | #408 |
| `target-size` | 1 in 1: a row's More button under the pinned filter bar after a scroll, on a phone | Nothing: left as the scroll's, its budget stays 1 (closed as not planned on 2026-11-14) | #409 |

**What fails**: a count that isn't its budget, which names the rule, the count and the budget,
what the rule asks with axe's help link, and the elements by selector and the start of their HTML,
ten at most, or, under its budget, says to lower it; a screenshot without a budget, which says what
to add to `checks.json`, what axe finds there; a screenshot without a name, or with a dot in its or
its spec's name but the endings; `budgets.accessibility` or `budgets.accessibilityTags` that can't be
read (not an object, a count that isn't a whole number of 0 or more, a key with a dot or empty, tags
that aren't a list of strings, or a tag axe doesn't know). And `e2e/accessibility.spec.ts` fails on a budget for a screenshot
with no baseline in `e2e/__screenshots__/`, or a baseline without a budget: every screenshot the
specs take has a baseline, since one without fails, so the baselines stand for the list of states.
A baseline left behind by a test that was removed keeps its budgets, which no test then reads.

**Over a budget**, fix what axe names. Raising a budget is a weakening: the checks guard marks a
budget raised, removed or no longer a number, and the deputy accepts it only with the measurement
and why it can't be met otherwise; the guard also marks any
change to the tags, which it reads as a budget that isn't a number. A rule a state didn't break
before is a budget raised from 0, the count a rule the state doesn't name has, so the guard marks
a new rule's budget too when `main` has budgets for that state, `{}` included
(decided by the owner on 2026-11-14, #410). A new screenshot's budgets are judged in the deputy's round; a new
state with `{}` has no number in it, so the guard marks nothing. A budget lowered needs nothing. An update of
axe-core (Dependabot's monthly group) may find more or less; its PR then fails the `visual` job, and
the budgets are read again there, a raised one marked as above.

**What it doesn't see.** Only what the screenshots show: a state no screenshot takes, a hover or a
focus ring but the few the specs set up, the light theme and English but in their few screenshots.
Nothing axe leaves to a person: whether a name makes sense, the order a screen reader reads in,
keyboard navigation and focus (`CLAUDE.md` → Conventions leaves those to each project), how the app
sounds in VoiceOver or TalkBack.

**In CI** it is part of the `visual` job, in the Playwright image the baselines are rendered in.
The reads add about 64 s of test time, about 32 s on the job's two workers: a whole run took 60 s in
Docker on a Mac with them, and the job 2 min 10 s in CI, against 1 min 26 s and 1 min 40 s on
`main` before. A failure uploads the Playwright report as the screenshots' do, and each
screenshot's test there has an `axe <spec>/<screenshot>` attachment with every element axe found,
which is also recorded as actual values, with how many rules axe found passing ([The actual values](#the-actual-values)).

**Its tests**: the rules (the budgets and tags read, the tags axe doesn't know, a screenshot's state from its name, the
verdict and its report, the budgets without a baseline and the baselines without a budget) are pure
functions in `scripts/accessibility/budget.ts`, tested in `budget.test.ts` (layer 1); coverage
measures the folder and Stryker mutates it. The read itself, in `e2e/test.ts`, and the check of the
baselines, in `e2e/accessibility.spec.ts`, are layer 6, beside the screenshot tests.

## The actual values

Each job that measures records the values its tools read, machine-readable, for a collector outside
this repository that charts them against their budgets over `main`'s commits (the owner's
`ai-workspace`, `quality-system/dashboard.md`). The logs and the job summaries have the same numbers,
but GitHub's API returns neither. `scripts/actuals/` does it for the `check` job (coverage), the
`performance` job (the size, the requests, the journeys and the layout shift) and the `visual` job
(the accessibility). Which tools each job measures with (`JOBS`) and each tool's health counters
with what each counts (`HEALTH`) are in `scripts/actuals/actuals.ts`: the files in the coverage report and in
the build, the screens opened and the journeys made, the states axe read and the rules it found
passing in them, and the like.

Each job uploads an `actuals-<job>` artifact on every run, PRs and `main`, also when it fails: one
file, `actuals-<job>.json`, in a shape the collector is written against:

```json
{"schema": 1, "sha": "<commit>", "job": "<job>",
 "tools": [{"tool": "size", "values": [{"key": "/js", "value": 185560}], "health": {"files": 21}}]}
```

- **`sha`** is the commit measured: a PR's head, not the merge commit GitHub runs a PR on.
- **`key`** is the budget's path under the tool's section of `checks.json` (`coverage.thresholds`,
  `budgets.size`, `budgets.requests`, `budgets.journeys`, `budgets.layoutShift`,
  `budgets.accessibility`) as a JSON Pointer (RFC 6901), since the names have dots and slashes in
  them: `/phone/downloads/~1qbt` is `budgets.requests.phone.downloads["/qbt"]`, `/lines` is
  `coverage.thresholds.lines`. A value and its budget join on it.
- **`value`** is what was measured, `null` when it wasn't, never 0 for that. Every budget of a tool
  has a value. A tool's file also has values with no budget: an axe rule found where its state has
  none, and, for a state read, each rule its budget names at 0 where axe found none. A layout
  shift is the screen's largest load, which is what its budget bounds.
- **`health`** says how much the tool measured, so a tool that measured less shows even when its
  values equal their budgets; `null` where it didn't count.

Each tool writes its part into `ACTUALS_DIR` (`actuals-parts/` in CI) as it measures, before its
budget's verdict, so a red run still has its numbers: `size.ts` before it judges the totals, the
browser tests through the attachments they make before their assertions, and coverage from the
report Vitest writes before it judges the thresholds, also when a test fails (`reportOnFailure` in
`vite.config.ts`). The job's last steps, which run whatever came
before (`!cancelled() || github.event_name == 'push'`: they skip a PR's run a later push cancelled,
but not a run of `main` cancelled because a job went past its `timeout-minutes`, which GitHub
cancels, per its workflow syntax's `timeout-minutes` and the status check functions in its
expressions page), put the parts into the file (`collect.ts`) and upload it; a tool that wrote no part (its
step never ran, or broke before measuring) gets every value and counter `null`. GitHub's docs don't say whether a job's later steps run after its timeout cancels it, so a
`main` run with no `actuals-<job>` artifact for a measuring job is a broken tool too, for the
collector as much as a file of nulls. Without
`ACTUALS_DIR`, as in a local run, nothing is written. The artifacts live as long as the repository
keeps them (90 days by default); the collector takes them from `main`'s runs while they do.

**Its tests**: the shape, the keys and each tool's values and counters are pure functions in
`scripts/actuals/actuals.ts`, tested in `actuals.test.ts` (layer 1); writing the parts, the
reporter and putting the file together in `io.test.ts` over a folder made in the test, and the
size's part in `scripts/size/size.test.ts` (layer 4). Each tool has a test that its part is written
when its budget fails. Coverage measures the folder and Stryker mutates it.

## The retro

Every fifty merged PRs a fresh session looks back at what the quality system did with them: the
review findings and the deputy's verdicts on the guard's marks, the bugs that got past every check, what the work cost
against how complex it was, which checks caught something and which only cost time, and where the
owner decided something. Where a pattern repeats, it changes the rules; a run of accidents changes
nothing (what counts as a pattern: `retro.md` → A pattern, not an accident, and → What it reads →
The review findings). It began on 2026-10-28 as a retro of the tests alone and became the whole system's on
2026-11-14.

The procedure that isn't Kinopeer's (what each input says, how a pattern is told from an accident,
what the retro gives the owner and how it makes a rule change) is the quality system's retro,
**version 3.3 (2026-11-20)**, in the owner's private repository (`ai-workspace`,
`quality-system/retro.md`), which the owner's sessions read and outside contributors don't need:
the retro is the maintainer's work. This section is Kinopeer's part of it: when, the queries and
commands that collect each input, where the rules it changes live, and the table of past retros.
What a finding carries, the tag the retro counts by, is in [TESTING.md](TESTING.md) → Improving the
system.

**Where the counts come from.** The quality system's database, in the owner's `ai-workspace`
(`quality-data/`), has a collector that reads this repository from GitHub every six hours and
`metrics_*` views that count each input by batch: `open` is every PR merged after the top row's
batch, and the issues closed since (`quality-data/README.md` → The metrics, which gives each view
and how a batch is bounded). The token that reads them lives only on the owner's Mac, so the retro
runs there, not in the cloud, with the command that README's Reading the metrics gives; each query
below is what goes after `--command`, and
`select * from metrics_batch_counts where project = 'kinopeer/kinopeer' and batch = 'open'` gives
the table's columns at once. First the data's age, as the same section says: every source fresh
and `metrics_last_pr` the PR that merged last. When a source is stale or failed, or the last
merges aren't in yet, the retro waits for the next run or takes that input from GitHub with the
`gh` commands kept below, and its row says which inputs came from where. A count the data can't
give is NULL, never 0, and the paragraphs below say what gives it then. GitHub still gives what no
view does: the count in When, which the deputy makes in the cloud, where the database can't be
reached; every round, read whole; and a job's time. The retro's range then goes into
`ai-workspace`'s `quality-system/data/manual_retros.csv`, which closes the batch (the same README →
Batches).

**When.** Once fifty PRs have merged that no row of the table below lists, Dependabot's left out; a release doesn't call
for one (decided on 2026-11-06: at ten PRs or each release a retro came almost daily, on batches too
small for a finding to repeat three times; raised from twenty on 2026-11-14 by the owner, who had
put the retro off past thirty to finish the planned work, while a batch of thirty-six gave every
repeat this one acted on). Count them with one command, from `<since>`, the latest `mergedAt` among
the PRs the table's top row lists, which takes in that retro's own PR and any PR
that merged while it was open: `gh api -X GET search/issues -f q="repo:kinopeer/kinopeer is:pr
is:merged merged:><since> -author:app/dependabot" --jq .total_count` (REST, so it runs where
GraphQL is refused; counted by hand, sessions gave 28, 30 and 32 for one batch of 36). The
deputy's round counts them so: when it finds fifty or more, its verdict says "retro due" and the
owner gets a push notification (the `deputy` skill → Posting the round), and the owner starts it. A
fresh session runs the retro, not one that wrote or reviewed the PRs in the batch.

**The review findings.** The deputy ends each round with a machine-readable block (the `deputy`
skill → Posting the round), which the views read:
`select f.check_name, f.rule, f.severity, count(*) as findings from metrics_findings f join metrics_pr_review p on p.project = f.project and p.number = f.pr where p.project = 'kinopeer/kinopeer' and p.batch = 'open' and p.known group by f.check_name, f.rule, f.severity`
counts the findings by check and by rule of the PRs whose every round's block reads, each once, in
the round that first reported it, and a round posted twice by its latest posting
(`metrics_findings_by_tag` counts every readable round, a PR's below too, so it isn't used here);
`metrics_batch_counts` has their totals, the
untagged ones, the PRs ready on the first round and the blocking findings. Those totals are NULL
while a PR's findings can't be read from blocks: a round whose block didn't read, or a PR merged
before the deputy's first round (2026-11-15). Those that rest on production code
(`ready_first_round_with_code`, `blocking`, `blocking_per_pr`) are NULL also while a PR's
`with_code` is unknown, which
`select number from metrics_batch_prs where project = 'kinopeer/kinopeer' and batch = 'open' and with_code is null`
names; such a PR's production code is read from its files, by the folders the table's columns
name below.
`select number, rounds, findings, untagged, blocking, unread_rounds from metrics_pr_review where project = 'kinopeer/kinopeer' and batch = 'open' and not known`
names those PRs, and their findings are counted from all their rounds: the deputy's reviews headed
`Round <n> at <sha>` (before 2026-11-15, the `Test review, round <n>` comments), with a search.
Since tags come in both spellings, `[H · gap]` and `[H · gap: <reason>]`, a search that expects `]`
right after the rule misses the second (#299, #302); one that catches both is
`\[[A-K] ?· ?(clear|gap|conflict)(\]|:)`. Where a block can be read, it is the count: a search
counts a round posted twice twice (#455) and misses a tag on a `/code-review` finding (#466).
Neither replaces reading: every reviewer round
is read whole, for the `/code-review` findings that carry no tag, the **For the coordinator**
items with the coordinator's decisions posted beside them, and the **Rule changes** the deputy
approved (before 2026-11-19, the owner's approvals posted on the PR).

The guard's marks are counted too, from the deputy's verdicts on them in every round (each
round's block lists them under `guard`; before 2026-11-15, the second reviews' comments,
`**Second review …**`): how many were judged, how many `weakening`, and how many of those the
deputy accepted, with its reasons. A mark counts once, as `weakening` when any round judged it so,
and as accepted or not by the latest round that judged it `weakening`.
The views don't give this count: `metrics_guard_marks` keeps only the latest round's verdicts on
the report at that round's commit, so a `weakening` an earlier round found and a later one judged
`sound` once the author fixed it is gone from it. When twenty PRs in a row with
changes to existing checks have no `weakening` verdict, the retro weighs handing the deputy's
subagent only the marks that weaken the checks, and decides it, as it decides its other rule
changes. Narrowing softens the system, so its PR says what the subagent then no longer sees.

**The escaped defects.** The issues closed since the same `<since>` that the top row doesn't count (an issue the
batch's last PR closed can close a moment after it, #412 after #415).
The issues are split by type: those of the Bug type are escaped bugs, counted by their `test-gap:*`
class against the pile's rule ([TESTING.md](TESTING.md) → When we find a bug); those of the Task type
with a `test-gap:*` label are problems of the tests and tooling, counted apart against the same
rule.
`select kind, class, number, closed from metrics_escaped_issues where project = 'kinopeer/kinopeer' and batch = 'open'`
lists them (`kind` `bug` for an escaped bug, `tests` for the tests' problems), and
`metrics_escaped` counts them by class; an issue the top row already names (one closed after its
batch's last merge and before that retro ran: `quality-data/README.md` → Batches) is left out of
both. From GitHub, for a class:
`gh api -X GET search/issues -f q="repo:kinopeer/kinopeer is:issue type:Bug label:test-gap:uncovered closed:><since>" -f per_page=100 --jq '.items[].number'`.
For each escaped bug the retro also names the check that should have caught it: a test on its
layer, a lint rule, a budget, the guard, a review's check by its letter, or a blind spot no check
can reach ([TESTING.md](TESTING.md) → Known blind spots).

**The effort.** The effort journal (in `ai-workspace`, `effort-journal/`) records what each
session's work cost and rates each merged PR's complexity. First rate the batch's PRs that have no
rating yet (`journal rate kinopeer/kinopeer#<n>`, one cheap request each), then read
`journal report --since <since>`: each PR's cost per complexity point and their median over the
batch, against the last retro's; each PR's cost by role (author, deputy, coordinator); the cost by model and effort; and the PRs that cost the most per point. What
Kinopeer's work costs, and every figure derived from it, is internal and this repository is
public, so those figures go to the owner's summary and to `quality-system/kinopeer.md` in
`ai-workspace`, never into this file, a PR or an issue; the table's row says only what the retro
changed because of them. `journal report` reads one history, across the journal's move from a Sheet to a database on 2026-11-17 (the effort journal's row in [Components](#components)). Retros before 2026-11-14 had no journal. The deputy's runs are meant to be
in the journal like any session's: a run that can't reach the journal stops and tells the owner
(the `deputy` skill → Whether to run); its rounds per PR come from its reviews. A cloud run from
before the deputy's round 2 on #447 (2026-11-15, the effort journal's row in
[Components](#components)) is missing from `journal report` for good, since its spool went with
its container. So the retro names the batch's PRs that had such runs,
`select number, lost_rounds from metrics_pr_cost where project = 'kinopeer/kinopeer' and batch = 'open' and lost_rounds > 0`
(the rounds with no run of the deputy's in the journal before them), leaves them out of the cost
per point and the batch's median, saying how many, and reads the cost by role and by model and
effort over the rows that were recorded, with the roles and models of the lost runs named as
missing. The views read the same journal: `metrics_pr_cost` gives each PR's cost and rating and
whether the cost per point counts it, `metrics_cost_per_point` the batch's cost per point repriced
by one price table, by class, role and model, and `metrics_completeness` how much of the batch
those figures stand on (the PRs rated, recorded and with a lost run).

**The checks' usefulness.** For each check (the components above, the tests' layers, the lint
rules, CI's jobs): what it caught in the batch, how often it failed for nothing a fix of the code
answered (a false alarm), and what it costs. GitHub reports a run by its latest attempt, so a job
that failed and was run again to green would hide its failure: count failed attempts, not runs.
The batch's failed jobs over every attempt, each once,
`select event, workflow, job, failed from metrics_failed_jobs where project = 'kinopeer/kinopeer' and batch = 'open'`
(a job that timed out counts as failed; the `pull_request` rows are the PRs' runs, the rest the
other events: pushes, so `main`'s CI and Edge and the tags' releases, manual runs and GitHub's own
`dynamic` ones), and its re-runs with the attempt before each,
`select run_id, attempt, workflow, event, branch, previous, conclusion, flaky from metrics_reruns where project = 'kinopeer/kinopeer' and batch = 'open'`
(`flaky`: a red attempt run again to green). From GitHub, each retro, the batch's PR runs that
failed or were run again,
`gh api -X GET repos/kinopeer/kinopeer/actions/runs -f event=pull_request -f created='><since>' --paginate --jq '.workflow_runs[] | select(.status == "completed" and (.conclusion == "failure" or .run_attempt > 1)) | [.id, .run_attempt, .name, .head_branch] | @tsv'`
(not `-f status=completed`, which drops runs: 2 of 105 on 2026-11-13, one a Guard run that
failed and was run again to green; GitHub lists at most 1,000 runs for a filtered listing, so a
bigger batch is listed a day at a time, `created=<day>`), and a run's jobs over all its attempts,
`gh api -X GET repos/kinopeer/kinopeer/actions/runs/<id>/jobs -f filter=all -f per_page=100 --paginate --jq '.jobs[] | [.run_attempt, .name, .conclusion, .started_at, .completed_at] | @tsv'`,
which also give a job's time. This listing reaches what the old recipe did: PR runs that ended
`failure` or were run again, not the other events nor a job that failed in a run that ended
`cancelled` (CI cancels a PR's run on the next push), which the views count. The collector sees a
re-run only of a run created in the last 7 days (`quality-data/README.md` → Known limits), so the
re-run of an older run is missing from both views: a run of this listing with `run_attempt` over 1
and no row in `metrics_reruns` is added to the counts, with its failed jobs. When the `runs`
source is stale, this listing and the jobs command give the PR runs' counts, and they give the
ids of the runs to open. The
guard's marks come from its `guard report` check on each PR's last head (its summary, the latest
run's, since a re-run writes another,
`gh api 'repos/kinopeer/kinopeer/commits/<sha>/check-runs?check_name=guard%20report' --jq '.check_runs | max_by(.completed_at) | .output.summary'`;
a report cut to fit is whole in the summary of the `Guard` run's `guard` job; before 2026-11-15,
from its comment on the PR). A failure fixed
by changing the check rather than the code, or a mark the deputy's verdict called needless, is a false
alarm. The cost is a job's time, and the
reviews' share of the effort above, which stays out of the row as every figure from the journal
does. The counts of what each check caught and of its false alarms go into the row.

**The owner's list.** What the owner reads here rather than approving it PR by PR: the weakenings
the deputy accepted, the changes to the guard, the rule changes the deputy approved (its rounds'
**Rule changes**), the budgets raised, the design values added, the decisions the coordinator took
on the deputy's **For the coordinator** questions and the product decisions it took (SPEC's
decision log), and the findings the deputy dropped after the author disputed them, each with its
PR. Then where the owner still decides PR by PR: an outside contributor's PR (the `deputy` skill →
The owner's approval) and a release. For those, how often each came up in the batch and how often
the owner changed something rather than approving it as it came. These counts go into the row.

Until 2026-11-19 the owner also approved, PR by PR, a change to the rules and a weakening of the
guard the task didn't explain, as well as the retro's rule changes, the deputy's **For the
coordinator** questions that revised or dropped a product decision or made a visible change, and,
on autopilot, credentials. The owner decided on 2026-11-19 (#488) that the owner's approval stays
only on releases and on communication with other people, since waiting for it held overnight
work; the rest is decided by the deputy or the coordinator, with its reason recorded where this
list reads it.

**What the retro changes.** The rules live in [TESTING.md](TESTING.md), the `test-review` and
`deputy` skills (`.claude/skills/`), the PR template, [CLAUDE.md](../CLAUDE.md) and this
file. A rule that is clear and isn't followed moves closer to where the author works, preferring,
in this order, a lint rule or a CI check, a default in a script or config (as the UTC time zone in
`vite.config.ts` is), a column or prompt in the PR template, a line in the author's checks in
[TESTING.md](TESTING.md) → Reviewing a PR's tests. Another sentence in the docs is the last resort.
The session decides the rule changes itself and makes them; the owner reads its result, a summary
of what it found and what it changed, and isn't waited for.

The changes go into one docs PR, reviewed like any other, which adds a row to the table below and
says which counts each change answers, so the next retro sees whether that count fell. The row and
the PR name the set behind each count (which PRs, which issues, closed since when). The table's
columns: "Ready on the first round" gives the merged PRs and those with production code, the folders `scripts/mutants.mjs` mutates
(`checks.json` → `mutants.folders`, which `checks.test.ts` holds `mutants.yml`'s `paths` and the
type check to; a row counts the folders of its time: `src/` and `server/` before #238, then
`tmdb-proxy/`, and the scripts' folders from #366, #378, #387 and #410 on); "Blocking findings per PR"
divides the blocking findings (the test review's blocking ones, and the `/code-review` bugs a
verdict says to fix in the PR, each counted once) by the PRs with production code, the same basis
in every row, so the column compares with the rows below it and with the Done rule (#222);
"Escaped bugs" counts the closed issues of the Bug type from the row after 2026-11-10's on (#346),
where it counted every `test-gap:*` issue but `flaky` before, so #283, now a Task, is among that
row's 5 `uncovered`. From the first retro after 2026-11-14 on, it also names for each bug the
check that should have caught it, and "What changed" also says what the effort, the checks'
usefulness and the owner's points led to.

**Done.** The system is stable when two retros in a row change no rules and the last batch averages
under one blocking finding per PR. From then on the retro runs every hundred merged PRs, and any new
`gap` or `conflict` starts the fifty-PR cadence again.

| Retro | PRs | Ready on the first round | Blocking findings per PR | Escaped bugs | What changed |
| --- | --- | --- | --- | --- | --- |
| 2026-11-20 | #417–#498, 58 merged (#417, the last retro's PR, merged after its row; Dependabot's #441–#443 left out; the other numbers are issues), 37 with production code (all but #417, #420, #422, #429, #431, #435, #444–#449, #451, #453, #459, #479, #483, #485, #487, #488 and #496; #429, #431 and #435 change only CSS, which the folders' `.ts` and `.tsx` rule leaves out). The first batch counted from the quality system's database: findings, rounds and CI from its views for #417–#497 (#417–#452 read from the rounds themselves, since the deputy's hidden block starts at #453), #498 from GitHub, since it merged after the views' last run. 641 findings in the posted rounds: 452 tagged (390 `clear`, 57 `gap`, 5 `conflict`: #417, #440 two, #451 two, all `H` and settled in their PRs) and 189 untagged, mostly nits | 6 of 58 (#426, #445, #448, #464, #482, #485), 3 of 37 with code (#426, #464, #482) | 2.24 (83 in the 37 with code: #498 13, #486 10, #477 8, #456 6, #462, #463 and #493 5 each, #450 and #469 4 each, #457 and #478 3 each, #428, #454, #474 and #490 2 each, #434, #439, #452, #455, #468, #470, #484, #489 and #495 1 each), plus 16 in ten PRs without code (#420 3; #429, #479, #483 and #496 2 each; #431, #435, #447, #451 and #487 1 each) | 17 closed since 2026-11-14, 15 `uncovered` and 2 `fake-drift`, 12 of them filed on 2026-11-12 to 14, before the batch, a backlog: step 4's budgets brought up 9 (layout shift #400, #401, #403–#406, by the layout shift check; axe #407–#409, by the accessibility budgets), and #386 (Search's field in a transition: a component test typing between renders), #390 (reduced motion's transition on every property: the tokens test) and #416 (an aborted signal into `withTimeout`: Later, a unit test). In the batch: #432 (the light theme's Completed chip: the accessibility budget, with no light state shot), #471 (desktop releases' last column narrower than its button: the edges, the narrowest desktop width), #472 and #473 (qBittorrent 5.2's preferences and its 409: the fakes against the service's own docs per supported version) and #494 (iOS Safari autocorrecting the address fields: a component test of the fields' attributes). Besides them, four Tasks with a `test-gap:*` label: #392 `silent-test`, #458 `flaky`, #465 and #476 `uncovered` | An equivalent survivor is said with the inputs tried and what each gave, and one whose difference shows only by another path isn't equivalent, in A test that can fail, the template's Mutants and the skill's K (K·clear 33; 8 survivors called equivalent in 4 PRs weren't, each blocking: #477 4, #486 and #493 1 each, #498 2). A check that reads a format with no parser it can use (the shell in a `run:`) says before its first round what it reads and which spellings it leaves unread, as classes, and which misses are findings, in Choosing a layer, the template's Neighbours and the skill's A (#456: nine rounds over one shell-comment scanner, its six blocking findings among them). The screenshot tests' list of screens and states goes, pointing at the specs and `e2e/__screenshots__/` instead, and the layers table's Where columns name where the tests are now, in TESTING (H·clear on that list in #462, #463, #474, #486, #489 and #498, a doc copying a list the code holds, which the 2026-11-14 rule already forbids). The deputy waits for `Mutants report` up to the `mutants` job's own timeout, not 30 minutes, and Dependabot's PRs wait the same, in the `deputy` skill (#477, #498 twice); reading the `mutants` run's outcome as well was tried in this PR and dropped after three rounds of findings on it. Tried and dropped in this PR: having the deputy read the PR again before posting and post nothing when it moved or had that round already (#455's duplicate rounds, twice, and #489's round after the merge); each review round of this PR found a new way it left a PR with no verdict or let an approval reach unreviewed code, and a duplicate round costs a run, not a wrong merge. Not in this PR: Settings' sheets get one way to send a save that outlives the sheet (#500; A·clear on a save in flight after the sheet closed in #462, #463, #486, #490, #493 and #498); a measurement of Stryker's `ObjectLiteral` mutator against values passed on (#501; K·clear in #468, #470 and #474); `smoke` and `performance` run in the pinned Playwright image (#502); #503, the flaky `delete.smoke.ts`. Not changed: H·clear 182 (97 in PRs of the rules and the tools, #496 23 and #488 13 the most; 85 in product PRs; the rules are plain), A·clear's other 95, F·clear 44 (#477 and #486 6 each), H·gap 28 (most in the PRs that changed the review itself, #417, #422, #440, #451, settled there), A·gap 11, C 11, E 8, G 8, D 5, K·gap 4, I 3, and the clash this PR's round 4 named between the `deputy` skill, where a `Mutants report` still missing after its wait gets a `CI at` review, and K and A test that can fail, where the reviewer runs the mutants itself when no report can come, which is `main`'s and is left to the next retro. The checks: CI caught 7 problems the review hadn't (check 1, `performance` 3: a layout shift and two size budgets, `visual` 3), with 6 false alarms, every one Ubuntu's archive not answering while the `smoke` and `performance` jobs installed Chromium's libraries on 2026-11-19 (#475, #477; #502), and one flaky failure on `main` (#503). The guard became a report that holds nothing (#439) and the deputy its judge (#440): of its marks, 6 PRs had a weakening judged, #451 and #496 not accepted until fixed, #454 accepted in its second round, #470, #488 and #495 accepted. The owner's list: weakenings accepted 4 (#454, #470, #488, #495), changes to the guard in #439, #440, #450, #451, #452, #455 and #456, size budgets raised in #486 and #498 (a measurement each), design values in #435 (the owner's choice) and #498, the coordinator's or the owner's answers to questions in 14 PRs (#417, #425, #429, #430, #434, #435, #439, #446, #456, #459, #475, #484, #490, #498), findings dropped after the author disputed them in #440, #450, #452 and #455, each with the reviewer's agreement; no outside contributor's PR and no release in the batch. The owner's approval went from every rule change to releases and other people's PRs on 2026-11-19 (#488). The effort, first measured in this batch, led to no change of its own: the costliest PRs are the ones with the most blocking findings above, so the changes above answer it too. The retro was due at #490, the fiftieth by merge time, and ran after #498. Worse on blocking findings (2.24 against 1.54) and on findings a PR (7.8 tagged against 7.5), better on the first round (3 PRs with code against 1); the escaped bugs are mostly the backlog step 4 found. This retro changes rules, so Done waits |
| 2026-11-14 | #340–#415, 36 merged (#340, the last retro's PR, merged after its row; #342, #343, #346–#348, #350, #352, #361, #362, #364, #365, #367–#370, #372, #373, #376, #377, #379, #380, #383, #388, #391, #395–#399, #402, #410, #411, #413–#415; Dependabot's #363 left out; the other numbers are issues), 26 with production code (all but #340, #346, #352, #361, #362, #364, #365, #377, #396 and #402). 270 tagged findings in the posted rounds: 192 `clear`, 73 `gap`, 5 `conflict` (#340, #380, #395 and two in #396; all but #380's settled in their PRs, #380's here), and 97 untagged, mostly nits; the 87 inline comments `/code-review` left on 13 of the PRs repeat the rounds' findings but for 5 nits | 3 of 36 (#365, #372, #377), 1 of 26 with code (#372); a posted "ready to merge" at the head of all 36 | 1.54 (40 in the 26 with code: #367 7; #368, #383, #398, #411 and #415 3 each; #369, #379, #380, #388, #391 and #399 2 each; #342, #350, #370, #376, #397 and #410 1 each), plus 1 each in #352 and #402 | 6 closed since #339 merged, all `uncovered`: #381, #387, #389 and #393 were brought up by step 4's new budgets (the requests table and the layout shift check), a backlog rather than a trend, #341 (theater rips and transport streams spelled with spaces for hyphens, the release-name parser again, fixed by #342) and #349 (Downloads' column names under the install card on desktop); besides them, two Tasks with a `test-gap:*` label: #412 `uncovered` (the guard didn't read an override's `excludeFiles`) and #337 `flaky`, closed as not planned (the runner stalled both tests at once) | A check that reads code, config, a workflow or CSS reads it with that format's parser, marks the whole where comparing parts gets intricate, and keeps a table of the spellings it must catch and let through, in the edges, the skill's A and the template's Neighbours (41 blocking and should-fix findings over spellings the readers of the guard, the tokens test and the lint config missed: #367–#370, #410, #411, #414 and #415, 40 of them A·clear, and #412, `uncovered`; the 2026-11-10 rule for patterns that read outside text was worded for the release-name parser and didn't reach them, and #415 settled only once its CSS went through PostCSS's tokenizer and a changed override was marked whole). A real timer is a sleep in Vitest, while a browser test waits in real time only for an absence nothing signals, with a comment and a deadline, in The clock and the skill's F (#380's F·conflict, left to this retro). A doc about how things are now doesn't copy a count or a list the code or CI holds but says where it lives, while a dated record keeps its numbers, in the author's docs check, the skill's H and the template's Docs (H·clear 80, 2.2 a PR, up from 1.24 and 0.89 in the two retros before: counts and lists out of step with the head in #340, #379 and #388, the folders `checks.json` mutates missing from the skill in #379 and from `mutants.yml` and `tsconfig.node.json` in #388; the rest are claims that say more than a check does, 23 `doc claim vs code` among them, which the existing rule covers). Not in this PR: a test that the folders in `checks.json` are the ones `mutants.yml`'s `paths` and the type check's `include` name, with the skill and this file pointing at `checks.json` instead of listing them, goes into a `chore:` PR of its own. The retro runs after fifty merged PRs no row lists, a hundred once the system is stable, counted from the latest `mergedAt` among the top row's PRs with one `gh` command given in When, which How's issue search shares (decided by the owner: he had put this one off past thirty to finish the planned steps, and counts by hand differed between sessions, 28, 30 and 32 for 36). Weighed and not taken, by the owner: a fresh-context pass over the docs' claims before a PR is marked ready. Not changed: H·gap 32 (11 in #396, the autopilot rules, settled there), F·clear 15, H·clear's claims that say more than the code (the rule is plain, and the change above takes away the copies that rot), C 5, G 3, D 3, B 1. Check E had no finding, and I none in seven retros; I stays, since the record it checks is what the pile counts. Second reviews: 25 passes on 13 PRs, one `weakening` (#395's second pass, fixed in the PR), six PRs with a second review since. For the owner in #342, #348, #365, #367, #370, #383, #388, #391, #395, #396, #410, #411 and #415. The retro was due at #377 (twenty from #340) and ran after #415. Better on blocking findings (1.54 against 2.0) and escaped bugs (6, four of them a backlog, against 8), the same on the first round (1 PR with code each time), worse on findings a PR (7.5 tagged against 4.8), most of them in the quality system's own checks; this retro changes rules, so Done waits |
| 2026-11-10 | #307–#339, 21 merged (#307–#310, #312–#315, #319, #320, #322, #323, #325–#328, #332–#334, #336, #339; #307, the last retro's PR, merged after its row; no Dependabot PR merged in the window; #311, #316–#318, #321, #324, #329–#331, #337 and #338 are issues, #335 answers 404), 12 with production code (#309, #310, #312, #314, #320, #323, #325, #327, #332, #333, #334, #336; #308 and #319 change only `vite.config.ts` and, in #308, its test, which `scripts/mutants.mjs` doesn't mutate). 100 findings in the posted rounds: 65 `clear`, 33 `gap`, 2 `conflict` (both in #307, settled there; #323's round 3 withdrew one of round 2's, left out) | 2 of 21 (#322, and #325, whose round 1 said "ready to merge" with a should-fix open), 1 of 12 with code (#325); a posted "ready to merge" at the head of 20 of 21: #334 merged at a merge of `main` that brought #332 and #333, which change its `parseRelease.ts`, on a `Merged main` comment instead of a round, the batch's one breach of the gate | 2.0 (24 in the 12 with code: #312 5, #334 4 with the spellings `/code-review` raised, #336 4, #310 3, #333 2, #309, #314, #320, #323, #327 and #332 1 each; 1.8 without #336), none outside them. 10 of the 24 are `/code-review` bugs in the PR's own change (#309, #310, #312, #323, #332, #333, #334 4), 6 of them in the release-name parser | 8 closed since 2026-11-08: 5 `uncovered` in four areas (coverage's config, #283; the server's bridges, #305 and #321; Downloads on a phone, #324; the release-name parser, #330) and 3 `environment` from one environment, the app on an iPhone's Home Screen behind Umbrel's app_proxy over HTTPS (#303, #304, #311); `flaky` #337 still open | Another place is found by a grep for what the diff changes (the function, the text's key, the component, the route), not for its words, and a place left as it is gets a reason checked against the code, in Choosing a layer, the template's Neighbours and the skill's A (7 findings, 4 blocking: #310, #312 2, #314, and #323's three A·gap, the key checks, the writes and the connect screen's login). A pattern that reads outside text is checked for what else it catches, with a table of the names a token must not read, in the edges, the template and A (7 A findings in the parser PRs, 5 blocking: #332's three A·gap, `Vo` read as a voice and two title words or spans; #333's A·gap, `S01E01-S03E05`; #334's three A·clear, `MPEG-TS` and «Звук: TS»; plus #334's spellings and #330, `uncovered`, in the same parser). A text's key is among what's broken by hand, since Stryker leaves strings alone (#314's A·clear and #327's K·clear, both blocking; turning `StringLiteral` back on was weighed and declined, since it would bring back the noise the 2026-10-30 retro removed), and a wiring step tells its handler from a sibling's (#336's K·gap), in A test that can fail, the template's Broken by hand and the skill's K (K·clear 7: #312 2, #336 2, #320, #327, #333). A merge of `main` needs a round when either of the two holds, a file both sides change counting even with their lines apart (#334, above), here, in the skill and in `CLAUDE.md`. Once a PR has its "ready to merge" it takes only fixes of what it does, and a new request is a PR of its own, in `CLAUDE.md` and here (#336: 19 findings in 7 rounds, 10 of them, 2 blocking, after its first verdict, from three commits of new requests, two after round 3's verdict and one after round 6's, and their fixes). A PR's kind is its title's prefix, not its branch's, in `CLAUDE.md`, here, the skill's I and the template (#319, #320, #323 and #325 merged from `claude/…` branches, which Claude Code names; #323's For the owner). "Ready to merge" leaves no blocking or should-fix finding open (#325's round 1). The tag's `gap: <reason>` form is part of the format, here and in the skill (#315 left it to this retro). The author's docs check and the template's Docs prompt have the changelog's entry name every change a user sees and claim no more than the code does (H·clear 4 on `CHANGELOG.md`: #314 and #332 left a change out, #323 and #339 claimed more). Not in this PR: an oxlint `no-restricted-properties` rule against new `vi.restoreAllMocks()` and `unstubAll…()` calls (F·clear 3: #309, #323, #334), with the 53 already in the tree removed (21 `restoreAllMocks`, 32 `unstubAllGlobals`; the 38 `vi.resetAllMocks()` stay, since they reset `vi.mock` module mocks, which `restoreMocks` doesn't), goes into a `chore:` PR of its own; the round #334 skipped, over `parseRelease.ts` on `main`, runs in a session of its own. Not moved into every PR, decided by the owner: the check of the installed app behind Umbrel's proxy, though its 3 `environment` meet the pile's rule, since they came from the first pass aimed at that environment, a backlog rather than a trend; the release checklist keeps its whole pass, and one more `environment` from that environment after 0.8.0 brings the rule back. Not changed: H·clear's other 22 (TESTING 7, #307's 4 among them; SPEC 5; the PR's description 5, #336 4 and #339; a checklist, the template, `CLAUDE.md`, an issue and a code comment one each; H·clear rose from 0.89 to 1.24 per PR), H·gap 14 (10 in docs PRs about the rules, #307, #313, #315 and #326, settled in each; #319 and #339's three), F·clear's titles that say more than the body 3 (#312, #325, #336's comment, the fourth batch in a row) and second copies 4 (#312, #313, #323, #327), F·gap 5 (two copies across files, #309 and #320), C·clear 4, D 3, E 2 (#310's Playwright route mock, E·gap, the rule naming `server/test/fakes.ts` alone), G 4 (#336 3; #326's, settled). Checks B and I had no finding; I has had none in six retros and stays, since the record it checks is what the pile counts. For the owner in #312, #320, #323, #328 and #336. The retro was due at #339 (20 before it) and ran after it. Worse on every column, in a batch with twice the PRs with code; this retro changes rules, so Done waits |
| 2026-11-08 | #264–#306, 27 merged (#264–#269, #271–#273, #280, #282, #284, #286–#289, #291, #293, #295–#302, #306; #265, the last retro's PR, merged after its row; Dependabot's #274, #275, #277, #278, #281 and #290 left out; the other numbers are issues), 6 with production code (#271, #293, #295, #296, #297, and #284, whose production lines are comments in two files, 0 mutants). 78 findings in the posted rounds: 33 `clear`, 45 `gap`, 0 `conflict` (#284's round 1 named one untagged, the skill's "ten or more" against this file's twenty, which #266 had settled on `main` the day before; its branch was older) | 9 of 27 (#264, #266, #267, #268, #286, #293, #295, #301, #302), 2 of 6 with code (#293, #295); a posted "ready to merge" at the head of all 27 | 0.67 (4 in the 6 with code: #284 2, #271 1, #296 1; 0.4 without #284), plus 2 in #291 (both A·gap), 1 in #269 (A·clear), 1 in #273 (a `/code-review` bug, `@types/node`'s majors) and 2 in #272 (`/code-review` alone, headed `Review round`, untagged, its reviewer writing that `/test-review` wasn't needed on a docs PR: the one breach of the rounds in the batch, as #179 was of the gate) | 4 closed since 2026-11-06, all `uncovered` (#270, #285, #292, #294), no `flaky` | Check H and the author's docs check cover every doc that describes what the diff changes, `CLAUDE.md` and the files in its docs table, the review skill, the PR template, the comments in workflows and config and `.env.example`, grepped over the whole tree, each claim checked against what it describes (the code, the service's own documentation opened, the UI's words, the doc it points at, a checklist step's pointer and check), in the author's checks, the template's Docs prompt and the skill (H·gap 32 and H·clear 24, 56 of the 78, by where each sat, a finding that cites a named doc among its places counted with the named ones: 30 in files the rule didn't name, README in #287, CONTRIBUTING, SECURITY, the skill and the template in #280, RELEASE_CHECKLIST in #288, #289, #298, #299 and 10 in #300's opening-day runbook, DEVELOPMENT and `.env.example` in #269, CHANGELOG in #296, ROADMAP in #306, workflow comments in #291 and #298; 17 in the named ones, TESTING, ARCHITECTURE, `CLAUDE.md` and SPEC, claims by meaning unread: #273 3, #269 2, #271 2, #297 2, #301 2, #265, #280, #282, #288, #289, #300, four of them citing both kinds, #269, #280, #282 and #288; 9 on the PR's description, next). The `Fixes for round <n>` comment brings the description's What, Tests and Docs to the head, and round 2 and later check it as the docs (9 H findings on the description, #273, #282, #286, #288, #291's banner and its Docs list after a merge of `main` dropped its hunk, #302 2, #306, plus #298's A·gap on its Not covered and #284's untagged test count). The No behavior reason names a run that can only come later, with what stays in place until it's green (#291's two blocking A·gap: the old token and deploy key revoked before the first run through `deploy`); a blind spot is an environment no layer can start, not Vite's dev server a Node test starts in 50 ms (#271, A·gap, here and in the blind spots' heading); the platform's own behavior includes GitHub Actions with what a workflow hands it, the hand-off checked and its documentation page named (#289 2, #298, each accepted that way by its round; #291's secret passed by name). The template's Seen red column says "one break per claim" (F·clear 3 of 4, a title or a comment that says more than the body, #284, #296, #297, the third batch in a row with it; a per-claim break would have left each green). Check F, here under Helpers and fixtures and in the skill, names a step with no effect without a comment (#287) and an assertion block repeated instead of an `it.each` row (#293) (F·gap 3; the third, #297's smoke import, got its oxlint rule there). Layer 4's Where names `vite.config.test.ts` (#271's round 2 left it to this PR). The edges gain what arrives from outside in an unexpected shape (3 `uncovered` in one area, the public-release audit's: a cross-site request, #270; an indexer's URL scheme, #292; an IPv6 caller, #294; the pass over the area was the audit itself, #296, #297 and #305, open; #285 is Stryker on a dependency bump, answered by #286's dry run). The retro counts tags in the reviewer's rounds only, since the author's `Fixes` comments repeat them. Not built: the CI check with an allowlist of records the last row named, since none of the 24 H·clear is a retired name a denylist would catch; H·clear fell from 1.11 to 0.89 per PR. Not changed: B·gap 1 (#284), C·clear 1, E·clear 1, G·gap 1 (#287's README screenshot, not a baseline), K·clear 1, K·gap 2, A·clear 2, the editorial H·gap in #301 (2), #289 and #280, and #273's Dependabot count, settled there. Checks D and I had no finding; I held in the batch's four `fix/` PRs (#271, #286, #293, #295) and stays. For the owner in six PRs (#271, #280, #287, #300, #302, #306), each settled by the owner before the merge. #282's round 2 ran at the merge commit a minute after `Fixes for round 1` at the next one; the retro was due at #299 (21) and ran after #306 (27). The second batch under one blocking finding per PR with code, but this retro changes rules, so Done waits |
| 2026-11-06 | #253 and #255–#263, 9 merged (#253, the last retro's PR, merged after its own row; #254 and #259 aren't PRs), 3 with production code (#257, #258, #260; #261 changes only a comment in `tmdb-proxy/wrangler.jsonc`, which `scripts/mutants.mjs` doesn't mutate). 22 findings: 11 `clear`, 11 `gap`, 0 `conflict` | 3 of 9 (#256, #260, #263), 1 of 3 with code (#260); a posted "ready to merge" at the head of all 9 | 0.67 (2 in the 3 with code: #257 1, #258 1), plus 1 in #253 (K·gap, a `TZ` stub in `beforeAll` that `unstubEnvs` put back) and 2 in #255 (`/code-review`, untagged: the release worker unchecked before the store PR, a dropped roadmap item without a decision record) | 0 closed since 2026-11-04, no `flaky` | A branch in a workflow includes which targets a matrix reaches, and a run that stops before it changes anything (a dry run, a read-only command, a bogus credential refused after the target is resolved) counts as run by hand, so a missing credential isn't a reason on its own, here and in the skill (A·gap 4: 3 in #258, two of them on `tmdb-proxy-key.yml`'s matrix, where round 2 accepted "the token lives only in the secrets" and round 4, an independent review after "ready to merge", resolved all four targets with a bogus token; #253's, `mutants.yml`'s concurrency group shared by forks' branches of one name, goes to [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before the public release, since no fork can open a PR while the repository is private). The docs grep takes the old value and each word of an old name on its own, and the author reads SPEC's and `CLAUDE.md`'s paragraphs about what the diff changes, in the author's checks, the template's Docs prompt and the skill's H (H·clear 10: 4 greps narrower than the old value, #258's `workers.dev` and port 8795, #261's two "Kinoseed" sentences; 2 claims by meaning, #257's Search paragraph and #258's TMDB proxy paragraph in `CLAUDE.md`; 1 a claim about another repository, #262; 1 a fix's own pointer, #258; 2 in #253, a claim true only for a branch that has `.gitattributes` and an aside in `CLAUDE.md` hard to read). Not a CI check yet: one couldn't tell a stale name from a record of the past, which keeps the old one (#258's H·gap); if H·clear doesn't fall by the next retro, a check with an allowlist of those records is the next step. A finding for the owner has no tag and no severity, doesn't hold the verdict and goes under **For the owner**, and the retro names it rather than counting it, here and in the skill (H·gap 5: this one from #253's round 3; #253's other two, `merge=union` keeping a line both sides rewrote and a stub only the file's load needs, were settled in #253; #257's decision restored after a revision and #258's records of the past keeping their names, now in SPEC's 2026-11-05 row, one case each). Coverage measures `tmdb-proxy/` too, which [Coverage](TESTING.md#coverage) didn't say (#264's review). Not changed: #258's third A·gap (literals that must match across files no test reads together, declined there with the reviewer's agreement), B·gap 1, K·clear 1, K·gap 1 (#253's, whose rule, Vitest putting stubs back before each test, that PR added). No finding for the owner in this batch. #258's `Fixes for round 1` came only after round 2 asked for it. Checks E and I had no finding in three retros and stay: E has #209's `fake-drift`, I applies to every `fix/` PR and this batch had none. The first batch under one blocking finding per PR, but this retro changes rules, so Done waits |
| 2026-11-04 | #230–#250, 17 merged (#230–#233, #235–#238, #240, #241, #243, #244, #246–#250; #234, #239, #242, #245 are issues), 15 with production code (all but #232 and #233; #238's is in `tmdb-proxy/`). 71 findings: 40 `clear`, 31 `gap`, 0 `conflict` | 2 of 17 (#240, #241), 2 of 15 with code; a posted "ready to merge" at the head of all 17 | 1.33 (20 in the 15 with code: #250 5, #231 3, #237, #238, #243, #246 and #247 2 each, #230 1, #248 1) | 1 closed since 2026-11-03 (`uncovered`: #239), plus 1 `flaky` (#245) | A test is seen red once per claim, a neighbour's answer included, in the rule and the template (A·clear 12, 5 of them a neighbour answered by a test that doesn't run its case; F·clear 9, 5 of them a title or a comment that says more than the body). Every Neighbours line was filled, so the CI check the last row named wouldn't have caught one. The neighbours gain a reload and the other side of a breakpoint or an allowlist; two accepted reasons (a branch in a script or a workflow, a limitation the owner kept), a behavior removed on purpose, and any PR adds the blind spot it meets, with a row for desktop Safari (A·gap 12, B·gap 1, G·gap 1, H·gap 1). Vitest puts back spies, globals and env before each test, and a test removes its own listeners and fake timers (F: 1 `clear` and 2 `gap`). What a test may count besides mocks (D·gap 3). Each operand of an `&&` chain, and outcomes that look alike (K·gap 3 of 4). A check that reads a file as text is layer 1 (C·gap 1). The template's Layer hint names the six layers and the duplicates (C·clear 4). A `/code-review` bug is recorded under A in the round that reports it (4 were left out). A merge of `main` that doesn't reach the PR's own lines takes a `Merged main` comment instead of a round (4 rounds after a merge alone found nothing: #237, #240, #243, #244), `CHANGELOG.md` merges with `merge=union`, and the author answers each round with `Fixes for round <n>`, which also asks for the docs grepped again after the fixes (H·clear 10, 3 of them in #233 itself, otherwise claims by meaning no grep finds). CI mutates every push to a ready PR's head, the latest one only, so a round reads CI's comment at the commit it reviews rather than running the mutants itself (about 11 local runs in this batch, one of which couldn't run: #246). The basis is production code, `tmdb-proxy/` included. Not changed: K·clear 3 (three different slips), F·clear's `saying()` 2 |
| 2026-11-03 | #207–#229, 10 merged (#207, #208, #222–#229; #209–#221 are issues), 6 with changes in `src/` or `server/` (#224–#229). 30 findings: 11 `clear`, 19 `gap`, 0 `conflict` | 5 of 10 reviewed (#207, #208, #223, #226, #229), 2 of 6 with code (#226, #229); a posted "ready to merge" at the head of all 10 | 1.33 (8 in the 6 with code: #224 3, #228 3, #225 2) | 2 closed since 2026-11-02 (1 `fake-drift`: #209; 1 `environment`: #210), no `flaky` | This PR also carries the 2026-11-02 row's follow-up, which never landed. The neighbours gain the edges and typing that replaces the history entry; three accepted reasons (a layout measured in the CI image, every environment a blind spot runs in, the platform's own behavior); what Stryker leaves alone is listed and broken by hand, and a survivor that only a test's reset hides isn't equivalent (A·gap 4 here and 7 in the last batch, K·gap 2 and 3). The template asks for each neighbour and a `Broken by hand` line (A·clear 5 here and 10 in the last batch); if A·clear doesn't fall by the next retro, a CI check that those lines are filled is the next step. The template's docs prompt greps for the numbers and names the diff changes (H·clear 3 and 5). Lists in the docs follow the change, a fix's manual check says what it needs to pass, and the columns here say what they divide by (H·gap 7). A flush at no delay is a real timer, an absence is asserted by name, test data carries no behavior the test isn't about (F·gap 3). One wording for three `environment`, in the class table and the pile (the conflict #222's code review named). Check J leaves the skill, with no finding in four batches (#136–#229); its rule stays in [Coverage](TESTING.md#coverage) |
| 2026-11-02 | #196–#206, 9 merged, 7 with changes in `src/` or `server/`. 38 findings: 25 `clear`, 12 `gap`, 1 `conflict` | 2 of 9 reviewed, 2 of 7 with code (#198, #206); a posted "ready to merge" at the head of all 9 | 1.71 (12 in the 7 with code: #204 6, #199 2, #200 2, #201 1, #202 1) | 5 closed since the last retro (2 `uncovered`: #194, #147; 3 `environment`: #175, #197, #203), plus 1 `flaky` (#145) | The phone check runs on a production build, `preview-lan` for a PR and Kinoseed Edge before a release, since `dev-lan` has no manifest (#197 and #203 of the 3 `environment` showed in the installed app; #175 shows in a Safari tab too). iOS stays a blind spot: layer 6 took what it could (#197 in #199), and neither WebKit in Playwright nor a simulator in CI would see the Home Screen app. The rest follows in a docs PR of its own after 0.6.1 (A·gap 7, A·clear 10, H·clear 5, and the two wordings of what three `environment` call for). Not changed: F·clear 3 (three different rules) |
| 2026-10-30 | #163–#193, 14 with code | 4 of 16 reviewed, 3 of 14 with code; #179 merged without a round, the one breach of the gate | 1.36 (19 in the 14 with code) | 12 closed since the last retro (10 `uncovered`, 2 `environment`), plus 1 `flaky` (#190) | `npm run test:mutants` and one CI run per PR head, survivors accounted for in the PR (A·clear 12, K·clear 4, B·clear 2). The neighbours of a change (10 `uncovered`). A second copy inside a file, fake timers, comments on assertions (F·gap 4). Who owns a test, and the set behind a retro's counts (H·gap 3). A docs prompt in the template, and wrapping is no finding (H·clear 8). The `flaky` class (I·gap 1). A `/code-review` bug is recorded under check A, which the skill now says, so A will rise next retro. Checks D and K in the skill point here. The gate stays as it is, docs-only PRs included |
| 2026-10-29 | #136–#162, 10 with code | 2 of 11 reviewed (10 with code and #136) | 0.9 (9 in the 10 with code), plus 3 in #136 | 10 closed since the last retro (8 `uncovered`, 2 `environment`) | Every round is posted with the commit both reviews saw, and a PR merges only on a posted "ready to merge" at its head. Nothing else: most of the batch and every escaped bug were written before #136, so the next batch judges the new rules |
| 2026-10-28 | #116–#135, 16 with code | 3 of 16 | 1.25 (20) | 0 | Layers 2 and 3 renamed and widened, mock assertions, a test that can fail, wiring places, error paths, routes and fakes, baselines, the Tests table, the review rounds, this section, TZ pinned to UTC |
