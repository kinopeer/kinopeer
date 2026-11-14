# Quality

Kinopeer's code is written and reviewed by AI agents. Its quality is held by three things: the
automated checks, independent reviews by sessions that didn't write the change, and the owner's
look at how the app behaves. This file says which parts of that system are in force here, and it
owns the rules of the checks guard and the retro. How the tests are organized and how a PR's tests are reviewed
is in [TESTING.md](TESTING.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

Any change to this file goes to the owner: the guard marks it.

## Components

Only what is on, being adopted, or declined with its reason; plans aren't listed.

| Component | State | What it does |
| --- | --- | --- |
| [The testing rules](TESTING.md) | On, version 1 of the quality system's testing component (2026-11-14), of which [TESTING.md](TESTING.md) is the source | How a change is covered by tests and reviewed: the lowest layer that sees a statement, the neighbours of a change, a test seen to fail, the accepted reasons for something uncovered, what a bug calls for and its seven `test-gap` classes, the review rounds and their tags |
| The effort journal | Being adopted (2026-11-14): built outside this repository, in the owner's `ai-workspace` (`effort-journal/`). Its hook records every session's turns on the owner's Mac and spools the rows locally; its Google Sheet's webhook isn't set yet, so nothing reaches the sheet and `journal report` has no data | Records what each session's work costs and rates each merged PR's complexity, which the retro sets against each other ([The retro](#the-retro)); the figures stay out of this repository, which is public |
| [The retro](#the-retro) | On since 2026-10-28 as the tests' retro, the whole system's since 2026-11-14, by version 1 of the quality system's retro | Every fifty merged PRs, reads the review findings, the escaped bugs, the effort against complexity, the checks' usefulness and the owner's points, and changes the rules where a pattern repeats |
| [The checks guard](#the-checks-guard) | On since 2026-11-12 (#366): its check is red while a PR lacks the records its marks call for, and is among `main`'s required checks | A script CI runs on every PR, which writes into the PR what in it weakens the checks, changes existing ones or adds a design value, and what record each of the three calls for |
| The design tokens check | On since 2026-11-14 (#411): a test in CI's `check` job, which is among `main`'s required checks | `src/styles/tokens.test.ts` fails a stylesheet's spacing, radius, type size, color, shadow or motion that the tokens have, and one they lack unless its line carries a comment saying why, and a `var()` that names a property nothing defines. What counts as a raw value is defined in `scripts/guard/stylesheets.ts`, which the guard reads too ([What it marks](#what-it-marks)) |
| The texts check | On since 2026-11-14 (#413): an oxlint rule, `react/jsx-no-literals`, that CI's `check` job runs | Fails a string that is a whole child in the app's JSX or the quoted value of an attribute a user reads or hears, so UI copy goes through translation keys; a string in braces in an attribute, inside an expression or outside JSX is left to review |
| The module boundaries check | On since 2026-11-14 (#414): an override of oxlint's rules for the pure logic folders, which CI's `check` job runs | Fails a module in `src/releases/`, `src/search/`, `src/torrents/` or `src/logic/` (hooks, providers and tests aside) that imports React, React Router, react-i18next, a Node built-in, a hook, a screen or a component, reads a global the browser or Node has but other platforms lack, or holds JSX, so pure logic runs anywhere (`docs/ARCHITECTURE.md` → Pure logic). Its cases are in `src/logic/pureModules.test.ts`; the guard sends widening what it allows (a global, a file left out, a rule turned off) to the owner, and a rule's options changed to a second review |
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

Three kinds of change, by what each calls for before the PR merges.

**For the owner**, to approve with a reason: a weakening of the checks, or a change to the guard
or its rules.

- A coverage threshold lowered or removed, a path added to what coverage leaves out, or one removed
  from what it measures (`coverage` in `checks.json`).
- A mutator added to those Stryker leaves out, a pattern added to the files it doesn't mutate, or a
  folder removed from those it does (`mutants` in `checks.json`).
- A budget raised, removed or no longer a number (`budgets` in `checks.json`, where more is
  weaker), a new rule's budget in an accessibility state `main` has budgets for among them: a rule a
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
  override added or removed is marked whole for the owner, with its JSON (one added with its place in the list), even one that checks
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
  - a job, a commit status or a check run under the guard's name in a workflow other than
    `guard.yml` (`guard:` as a job's key, `name: guard`, `context=guard` for the statuses API,
    `name=guard` or `name: 'guard'` for the checks API), which could report in the guard's place.
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
- Any change to `scripts/guard/`, `.github/workflows/guard.yml`, this file or the second review's
  procedure (`.claude/skills/second-review/`).

**For the coordinator**, to approve with a reason: a design value added or changed. A value the
design doesn't have yet is a decision someone signs, and the owner decided that the coordinator
does: the owner, or the coordinator session of a task on autopilot (`CLAUDE.md` → Workflow →
Autopilot).

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

**For a second review**: a change to an existing check that a script can't judge.

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
- `checks.json`, `.oxlintrc.json` or `package.json` whose copy on `main` the guard can't read, so
  that it has nothing to compare the branch's with.

A new sign goes into `scripts/guard/` (`signs.ts`, or `assertions.ts` and `tests.ts` for what the
tests assert and which of them ran, `stylesheets.ts` for what counts as a raw value in a stylesheet) with its tests and into this list, in one PR, which
goes to the owner as any change to the guard does. The list is never whole, and isn't meant to be:
the guard is a tripwire for the cheap, known ways around a check, and the reviews catch the rest.
A way around that a review finds goes into [What it doesn't see](#what-it-doesnt-see); it joins
the list through the retro ([The retro](#the-retro)), once it has been met in a PR or
costs one line.

### What a marked PR needs

The guard's marks are three lists, for the owner, for the coordinator and for a second review.
While a list isn't closed by a record, the `guard` check is red; a PR without marks has it green.

**The code of a list.** Each list has a code: a short hash of its marks (what each calls for, its
file and what it says, without line numbers) and of the marked files as they are at the branch's
head. A record names the code, so it holds while the marks and the marked files are the same:
once a marked file or the list itself changes, the code is another and the list needs a new
record. A push that touches neither (a doc, `CHANGELOG.md`, a merge of `main` in other files)
leaves the record in force, unless a mark's own text carries a count the push changes: "fewer
tests run" names both sides' totals, so a merge of `main` that brings a test gives that list
another code.

**A record** is a comment on the PR whose first line is one of four; the rest is free text:

- `**Second review <code>: sound**`: the second review found no weakening among the list's marks;
- `**Second review <code>: weakening**`: it found one, or couldn't decide;
- `**Owner's approval <code>:** <reason>`: the owner approves, with the owner's reason on that
  line, in English;
- `**Coordinator's approval <code>:** <reason>`: the coordinator approves the design values, with
  the coordinator's reason on that line, in English.

The guard prints these lines with the codes in its comment, to be copied rather than composed from
memory. A record counts only from someone the owner let into the repository: a member of the
organization or a collaborator invited to it (`author_association` `OWNER`, `MEMBER` or
`COLLABORATOR`), not an outside contributor or a bot, since the repository is public and anyone
can comment. GitHub answers that field by who asks: a member whose membership is private is a
collaborator to the workflow's token, which is why a collaborator counts. The cost is that a
collaborator invited with any role could post a record; when one is invited who must not, the
rule becomes a list of logins in `checks.json`. So that a comment read otherwise than expected
shows, the report says how many comments it read and how many of them count, and the job's log
how its token sees their authors. On an outside contributor's PR or Dependabot's the records are
posted by the maintainer's sessions, as the reviews of such PRs are.

**What closes what.**

- The list for the owner: the owner's approval of its code.
- The list for the coordinator: the coordinator's approval of its code, or the owner's, since the
  owner is a coordinator too. Neither closes another list.
- The list for a second review: a second review of its code that found it `sound`. After a
  `weakening`, either a fix (the marked file changes, so does the code, and the second review is
  done again) or the owner's approval of the same code. Without a `weakening` record the owner's
  approval doesn't close this list: the shortest way past a second review would otherwise be to
  ask the owner to wave the list through, and judging rewritten assertions is reading code. A
  `weakening` isn't cleared by another second review of the same code that says `sound`:
  reviewing the same files again isn't a way past the first verdict.
- A wrong mark for a second review is closed by the second review's `sound`; a wrong mark for
  the owner by the owner's approval.

**The owner's approval.** The session that asks the owner to approve the merge first shows, in a
card of its own before the merge's, what is to be approved, a line each: for a weakening from the
owner's list, what stops being caught, with the before and the after; for a change to the guard
or its rules, what changes in the guard and why; for what the second review called a weakening,
its line on the mark. The reason in the record is the owner's own: the session offers no
ready-made reason, and doesn't record an approval without one, but asks for it. It writes the
reason in English, as everything on GitHub is, whatever language the owner gave it in, and
doesn't quote the original.

**The coordinator's approval.** It is posted by the coordinator only: the owner, or the
coordinator session of a task on autopilot, never the session that wrote the PR or one that
reviews it, which the record's first line can't tell apart, since every session posts as the
owner's account. The reason is the coordinator's own: why the design needs that value, a token
the scale lacks or a size made of other elements' sizes. On autopilot the coordinator decides
it as it decides the task's other choices (`CLAUDE.md` → Workflow → Autopilot); otherwise the
session that asks the owner to approve the merge asks about the list first, in a card of its own,
as for the owner's approval.

**After a record** the session that posted it re-runs the guard's job
(`gh run rerun <run> --failed`): the check doesn't react to a new comment by itself. A record
without a re-run leaves the check red, which is visible and harms nothing.

**The second review** is done by a fresh session with `/second-review <PR#>`
(`.claude/skills/second-review/`), which owns its procedure.

**When the guard itself is broken.** The `main` ruleset has no bypass for anyone. With `guard`
among its required checks, a guard's job that fails by itself (an error in the script, not a
mark) stops every PR, and the one way out is the owner's: taking `guard` out of the required
checks in the repository's settings until the fix is merged.

### The thresholds and the exclusion lists

They sit in `checks.json`, as data, so that the guard compares them exactly: `vite.config.ts` reads
from it what coverage measures and its thresholds, `stryker.config.mjs` the mutators left out,
`scripts/mutants.mjs` the folders mutated and the files in them that aren't production code,
`scripts/size/size.ts` the size budgets (`budgets.size`, [The size budget](#the-size-budget)), the
requests tests the requests budgets (`budgets.requests` for the screens' openings and
`budgets.journeys` for the moves between them, [The requests budget](#the-requests-budget)), the
layout shift test the layout shift budgets (`budgets.layoutShift`, a score per window size and
screen, and the ceiling over them, `budgets.layoutShiftCeiling`, `docs/TESTING.md` → The layout
shift test), and the screenshot tests the accessibility budgets and the tags axe checks
(`budgets.accessibility` and `budgets.accessibilityTags`, [The accessibility budget](#the-accessibility-budget)). A new
threshold, budget or exclusion list goes there too, not into the config that uses it, where the
guard wouldn't see it move.

### How it runs

**In CI** the `guard` job runs on every PR (`.github/workflows/guard.yml`). It runs `main`'s copy of
the script, not the branch's, so a PR that changes `scripts/guard/` is still read by the guard it
found. The script reads the branch through git and runs none of its code; the one package it
needs, the parser that comes with Vite, is installed from `main`'s lockfile. The workflow file is
another matter: on `pull_request` GitHub runs it as the PR has it, so a PR that changes `guard.yml`
runs its changed steps, and what `main`'s script does about it is mark the change for the owner.
What the guard finds goes into the job's summary and into one comment on the PR, which the job
edits in place on every push; a fork's PR gets the summary alone, since its token can't comment.
The job also reads the PR's comments and hands them to the script as data, for the records in
them; after writing its comment it fails while a list of marks lacks its record
([What a marked PR needs](#what-a-marked-pr-needs)).

The lists of the tests that ran come from a job of their own, `tests`, which the `guard` job waits
for. It installs and runs both sides, the commit the branch left `main` at and the branch's head:
the Vitest tests with the JSON reporter, since only a run has a table's every row as a test and
knows a skipped one, and Playwright's `--list` for the screenshot tests, the smoke journeys and
the requests test (on a side that has its config), which needs no browser. A failing test is still a test that ran; CI's own jobs fail for it. The
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
(`--tests-base` and `--tests-head` name two folders of such reports, for one made by hand). Nor
does it read a PR's records: it prints the record each list needs, with its code, and says they
weren't read (`--comments` names a file of the PR's comments, one JSON object a line).

### What it doesn't see

- A check weakened from inside: a config that stops reading `checks.json`.
- A test that checks less with its assertions left as they were written: what it sets up before
  them changed (a fixture, a mock, the input), a helper or a matcher made looser where it is
  defined, in another file; a table the guard can't open, imported or computed, whose rows
  changed; a query that throws when nothing matches, used as a check without `expect`
  (`screen.getByRole('button')` on a line of its own), rewritten or removed.
- What a test asserts when the same change renames it: the test goes to a second review as gone
  or renamed, and its assertions aren't compared.
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
  from an npm script that still exists (the script changed, which goes to a second review).
- A tracked file named in `.gitignore`: oxlint skips what git ignores, so the path is taken out
  of the lint from a third file, beside `ignorePatterns` and the lint ignore files.
- A removed step of plain shell, with no npm script, npx tool, node script, docker command or
  action in it (`curl` against a server, a shell test): it goes to a second review, not to the
  owner. So does a check dropped from a step whose commands all stay.
- An action's inputs (`with:`) and a step's other keys but `if:` and `continue-on-error:` (`env:`,
  `working-directory:`): a change to them isn't read, so a check an input turns off
  (`fail-on-error: false`) is marked nowhere.
- In reading a workflow's commands: a comment after a block's start (`run: | # the tests`) keeps
  the block's lines from being read; a flag with a value before an npm script (`npm --prefix
  tmdb-proxy run test`) is read as the script, and one before docker's subcommand (`docker
  --context ci run`) as the subcommand; `node` with a flag first (`node --test server`) isn't
  read as a command; a command that goes on on the next line (`docker \` and then `run`) is
  read as two lines: docker and npm read no command there, so the step, removed, goes to a second
  review, while npx and node read `npx \` and `node \`, which go to the owner under that name;
  an image used as an action (`uses: docker://alpine:3.20`) is another action after its tag
  moves.
- A command's word in a step's message is marked, though it runs nothing: `echo "the docker image
  is ready"` reads as `docker image`, and removing that step goes to the owner. The guard reads
  the words wherever they stand rather than work out where a command starts.
- A key in `checks.json` with a dot in its name (`"size.js"` under `budgets`, `"thresholds.lines"`
  under `coverage`, or a key that is empty): the guard joins the keys of a path with dots, so such a
  key lands on the same path as the real one and hides what the real one did, a budget raised or a
  threshold lowered.
- Whatever reading YAML line by line gets wrong: it finds `run:` and `uses:` keys and the lines
  indented under a block, and knows nothing of anchors or of a command built by an expression.
- A change to `guard.yml` that stops the script from running or from being `main`'s copy: the
  workflow runs as the PR has it, so the mark for the owner comes from the changed steps, if they
  still make it.
- A green `guard` reported by another workflow of the PR. GitHub's Free plan has no way to
  require that a check come from `main`'s copy of a workflow, and the guard marks a job or a
  status of its name for the owner by one pattern, no more.
- Anything written on purpose to get past it. Every session works under the owner's GitHub account,
  so the guard protects against forgetting, not against forging.

Those are the reviews' to catch (`TESTING.md` → Reviewing a PR's tests).

### Its own tests

They sit next to it: the signs as pure functions in `scripts/guard/signs.test.ts`, the reading of
a test file in `assertions.test.ts`, the comparison of the tests that ran in `tests.test.ts` and
the records in `records.test.ts` (layer 1), the reading of a branch and of the reports' folders in `scripts/guard/guard.test.ts`,
over a git repository made in the test (layer 4). Stryker mutates the guard as it does the app's
code.

## The size budget

A change can make the app heavier without a line that says so: a new dependency, an import that
pulls in a whole library, an asset. The size budget makes that a failing check. After
`npm run build`, `npm run size` (`scripts/size/`) sums the files in `dist/` by kind and compares
each sum with its budget in `checks.json`:

| Kind | Counted | Budget |
| --- | --- | --- |
| JS (`.js`, `.mjs`) | gzipped, at gzip's default level | `budgets.size.js` |
| CSS | gzipped, the same way | `budgets.size.css` |
| Everything else | as it is | `budgets.size.rest` |

gzip is a steady measure of the text rather than the bytes a browser gets: `server/static.ts` sends
Brotli to a browser that takes it and gzip only to one that doesn't. The rest is mostly fonts and
icons, compressed already; its few text files (`index.html`, the manifest, `favicon.svg`,
`version.json`, about 6 kB) count as they are, though the server compresses those over 1 kB.

The sums are per kind rather than per file, since the files' names carry hashes that change with
their content. Each budget is a whole number of bytes, about 5% above what the build measured when
it was set: on 2026-11-12, 186,937 bytes of JS, 15,392 of CSS and 184,330 of the rest, against
budgets of 196,300, 16,200 and 193,600. Clean builds in a row gave the same numbers to the byte,
and CI's build on Node 22 the same as a local one on Node 24: the size is exact, so the margin is
room for ordinary changes, not for noise. It is exact for the dependencies `package-lock.json`
names: a local `node_modules` that drifted from it builds another size, so measure after `npm ci`.

**In CI** it is the step after `npm run build` in the `performance` job, which adds a table of the kinds,
their sizes, budgets and what is left to the job's summary. It fails over a budget, and also when
it can't check: a `dist/` that is missing, a build without a file of each kind (cut short, or
with files named in a way it doesn't read, such as `.cjs`), an entry in `dist/` that is neither a
file nor a folder (a symlink, which the server would still serve), a `checks.json` it can't read, a
budget that is missing or not a whole number of bytes above 0. It takes no arguments, so the
budgets come from `checks.json` alone, where the guard compares them. A failure names the kind that
grew, by how much it is over, and its three heaviest files.

**Over a budget**, find what grew: build `main` and the branch, each after `npm ci`, run
`npm run size` on each and compare the files of that kind; then make it smaller or leave it out. Raising a budget to get a PR
through is a weakening: it is the owner's decision, and the checks guard marks a budget raised,
removed or no longer a number for the owner. A new budget goes to a second review. A budget
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
weakening: it is the owner's decision, and the checks guard marks a budget raised, removed or no
longer a number for the owner. **Under a budget**, lower it in `checks.json` to the new count: a
budget lowered needs no record. A new budget, for a new screen or a new move, goes to a second review.

**In CI** it is the step after the size budget's in the `performance` job, on the same build,
Chromium from the cache as in the `smoke` job; the reporter `e2e/performance/summary.ts` adds the
tables of the counts, the openings' and the moves', to the job's summary, and a failure uploads the Playwright report with its
traces.

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
jump, its issue named beside it in TESTING, and the fix lowers it: today Downloads on desktop
(0.02, the header's tools moving as the totals come in, #405), a title's
and a series' page on desktop (0.02, the hero's backdrop fade, #406), and the releases at
`desktop-rail` (0.04) and `desktop-1280` (0.03), the filter bar wrapping to a second line once the
filters land (#400). A budget is one number for both orders of a screen, so where a carried jump
shows in one order only, a new jump as large passes in the other; these read the same in both
orders but the title's and the series' page (0.0093 and 0.0122), so the room under them is the
rounding's, and on those pages 0.003 more in one order.

**What fails**: a reading over its budget, which names each shift with the elements that moved and
their boxes before and after; a screen of the list without a case or a budget, or a budget for a
screen the test doesn't read; `budgets.layoutShift` that can't be read (not an object, a budget
that isn't a number of 0 or more, one over the ceiling, a ceiling missing or not over 0); a request the case doesn't name; a chain
the page doesn't follow.

**Over a budget**, find what moves (the failure names the elements) and keep it in place or keep
room for what loads later. Raising a budget is a weakening: it is the owner's decision, and the
checks guard marks a budget raised, removed or no longer a number for the owner. A new budget, for
a new screen, goes to a second review. **Under a budget** by a step of 0.01 or more, after a fix,
lower it in the same PR: a budget lowered needs no record. The ceiling is in `checks.json` beside
the budgets, so the checks guard marks it raised for the owner as it does a budget.

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
guard marks a budget removed for the owner.

**The violations found at the start** are the budgets today, each rule with its issue, and their
fixes lower them (decided on 2026-11-14: fixing them first would turn the step into design work,
and a visible fix is the owner's):

| Rule | Elements, states | What a fix changes | Issue |
| --- | --- | --- | --- |
| `label-content-name-mismatch` | 44 in 44: Downloads' status button on desktop, the phone's sort button with a type filter, the torrent's category row, a torrent in a title's "In downloads" | Nothing on the screen: the accessible names | #407 |
| `color-contrast` | 11 in 3: secondary text on a selected torrent, on a phone and in the desktop table, and on a skipped file | The colors, so the owner's | #408 |
| `target-size` | 1 in 1: a row's More button under the pinned filter bar after a scroll, on a phone | Maybe nothing: it may be left as the scroll's | #409 |

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

**Over a budget**, fix what axe names. Raising a budget is a weakening: it is the owner's decision,
and the checks guard marks a budget raised, removed or no longer a number for the owner, and any
change to the tags, which it reads as a budget that isn't a number. A rule a state didn't break
before is a budget raised from 0, the count a rule the state doesn't name has, so the guard marks
a new rule's budget for the owner too when `main` has budgets for that state, `{}` included
(decided by the owner on 2026-11-14, #410). A new screenshot's budgets go to a second review; a new
state with `{}` has no number in it, so the guard marks nothing. A budget lowered needs no record. An update of
axe-core (Dependabot's monthly group) may find more or less; its PR then fails the `visual` job, and
the budgets are read again there, a raised one going to the owner.

**What it doesn't see.** Only what the screenshots show: a state no screenshot takes, a hover or a
focus ring but the few the specs set up, the light theme and English but in their few screenshots.
Nothing axe leaves to a person: whether a name makes sense, the order a screen reader reads in,
keyboard navigation and focus (`CLAUDE.md` → Conventions leaves those to each project), how the app
sounds in VoiceOver or TalkBack.

**In CI** it is part of the `visual` job, in the Playwright image the baselines are rendered in.
The reads add about 64 s of test time, about 32 s on the job's two workers: a whole run took 60 s in
Docker on a Mac with them, and the job 2 min 10 s in CI, against 1 min 26 s and 1 min 40 s on
`main` before. A failure uploads the Playwright report as the screenshots' do, and each
screenshot's test there has an `axe <spec>/<screenshot>` attachment with every element axe found.

**Its tests**: the rules (the budgets and tags read, the tags axe doesn't know, a screenshot's state from its name, the
verdict and its report, the budgets without a baseline and the baselines without a budget) are pure
functions in `scripts/accessibility/budget.ts`, tested in `budget.test.ts` (layer 1); coverage
measures the folder and Stryker mutates it. The read itself, in `e2e/test.ts`, and the check of the
baselines, in `e2e/accessibility.spec.ts`, are layer 6, beside the screenshot tests.

## The retro

Every fifty merged PRs a fresh session looks back at what the quality system did with them: the
review findings and the second reviews, the bugs that got past every check, what the work cost
against how complex it was, which checks caught something and which only cost time, and where the
owner decided something. Where a pattern repeats, it changes the rules; a run of accidents changes
nothing (what counts as a pattern: `retro.md` → A pattern, not an accident, and → What it reads →
The review findings). It began on 2026-10-28 as a retro of the tests alone and became the whole system's on
2026-11-14.

The procedure that isn't Kinopeer's (what each input says, how a pattern is told from an accident,
what the retro gives the owner and how a rule change is approved) is the quality system's retro,
**version 1 (2026-11-14)**, in the owner's private repository (`ai-workspace`,
`quality-system/retro.md`), which the owner's sessions read and outside contributors don't need:
the retro is the maintainer's work. This section is Kinopeer's part of it: when, the commands that
collect each input, where the rules it changes live, and the table of past retros. What a finding
carries, the tag the retro counts by, is in [TESTING.md](TESTING.md) → Improving the system.

**When.** Once fifty PRs have merged that no row of the table below lists, Dependabot's left out; a release doesn't call
for one (decided on 2026-11-06: at ten PRs or each release a retro came almost daily, on batches too
small for a finding to repeat three times; raised from twenty on 2026-11-14 by the owner, who had
put the retro off past thirty to finish the planned work, while a batch of thirty-six gave every
repeat this one acted on). Count them with one command, from `<since>`, the latest `mergedAt` among
the PRs the table's top row lists, which takes in that retro's own PR and any PR
that merged while it was open: `gh api -X GET search/issues -f q="repo:kinopeer/kinopeer is:pr
is:merged merged:><since> -author:app/dependabot" --jq .total_count` (REST, so it runs where
GraphQL is refused; counted by hand, sessions gave 28, 30 and 32 for one batch of 36). The
review counts them so: when it finds fifty or more,
its verdict line says "retro due", and the
coordinator of the work (the owner, or the session that hands out PRs) starts it. A
fresh session runs the retro, not one that wrote or reviewed the PRs in the batch.

**The review findings.** Collect the `Test review, round <n>` comments of the merged PRs no row lists yet (the
batch) and count the findings by check and by rule. Since tags come in both spellings, `[H · gap]` and `[H · gap: <reason>]`, a search that expects `]`
right after the rule misses the second (#299, #302); one that catches both is
`\[[A-K] ?· ?(clear|gap|conflict)(\]|:)`. The search doesn't replace reading: every reviewer round
is read whole, for the `/code-review` findings that carry no tag and the **For the owner** items.

The second reviews are counted too, from the `**Second review <code>: …**` comments of the batch's
PRs ([What a marked PR needs](#what-a-marked-pr-needs)): how many were done, and how many said
`weakening`. When twenty PRs in a row with a second review have no `weakening` verdict, the retro
proposes to the owner to narrow the second review to weakenings. Narrowing softens the system, so
it is the owner's to decide.

**The escaped defects.** The issues closed since the same `<since>` that the top row doesn't count (an issue the
batch's last PR closed can close a moment after it, #412 after #415).
The issues are split by type: those of the Bug type are escaped bugs, counted by their `test-gap:*`
class against the pile's rule ([TESTING.md](TESTING.md) → When we find a bug); those of the Task type
with a `test-gap:*` label are problems of the tests and tooling, counted apart against the same
rule. For example,
`gh api -X GET search/issues -f q="repo:kinopeer/kinopeer is:issue type:Bug label:test-gap:uncovered closed:><since>" -f per_page=100 --jq '.items[].number'`.
For each escaped bug the retro also names the check that should have caught it: a test on its
layer, a lint rule, a budget, the guard, a review's check by its letter, or a blind spot no check
can reach ([TESTING.md](TESTING.md) → Known blind spots).

**The effort.** The effort journal (in `ai-workspace`, `effort-journal/`) records what each
session's work cost and rates each merged PR's complexity. First rate the batch's PRs that have no
rating yet (`journal rate kinopeer/kinopeer#<n>`, one cheap request each), then read
`journal report --since <since>`: each PR's cost per complexity point and their median over the
batch, against the last retro's; each PR's cost by role (author, reviewer, second reviewer,
coordinator); the cost by model and effort; and the PRs that cost the most per point. What
Kinopeer's work costs, and every figure derived from it, is internal and this repository is
public, so those figures go to the owner's summary and to `quality-system/kinopeer.md` in
`ai-workspace`, never into this file, a PR or an issue; the table's row says only what the retro
changed because of them. Retros before 2026-11-14 had no journal.

**The checks' usefulness.** For each check (the components above, the tests' layers, the lint
rules, CI's jobs): what it caught in the batch, how often it failed for nothing a fix of the code
answered (a false alarm), and what it costs. GitHub reports a run by its latest attempt, so a job
that failed and was run again to green would hide its failure: count failed attempts, not runs.
The batch's runs that failed or were run again,
`gh api -X GET repos/kinopeer/kinopeer/actions/runs -f event=pull_request -f status=completed -f created='><since>' --paginate --jq '.workflow_runs[] | select(.conclusion == "failure" or .run_attempt > 1) | [.id, .run_attempt, .name, .head_branch] | @tsv'`,
and each one's failed jobs over all its attempts,
`gh api -X GET repos/kinopeer/kinopeer/actions/runs/<id>/jobs -f filter=all --jq '.jobs[] | select(.conclusion == "failure") | [.run_attempt, .name] | @tsv'`;
the guard's marks from its comment on each PR. The guard's check red while a marked PR waits for
its record is the mark doing its work: it counts with the marks, not as a failure. A failure fixed
by changing the check rather than the code, or a mark the second review called needless, is a false
alarm. The cost is a job's time from the same jobs' `started_at` and `completed_at`, and the
reviews' share of the effort above, which stays out of the row as every figure from the journal
does. The counts of what each check caught and of its false alarms go into the row.

**The owner's points.** Where the owner decides in Kinopeer: approving a merge (in the owner's
sessions; on autopilot the coordinator merges), a **For the owner** finding, an approval of what
the guard marked for the owner ([What a marked PR needs](#what-a-marked-pr-needs)), a design value
the coordinator approves in the owner's sessions, a check on the test stand, and a release. For
each, how often it came up in the batch and how often the owner changed something rather than
approving it as it came, from the PRs' comments and the records the guard reads. These counts go
into the row.

**What the retro changes.** The rules live in [TESTING.md](TESTING.md), the `test-review` and
`second-review` skills (`.claude/skills/`), the PR template, [CLAUDE.md](../CLAUDE.md) and this
file. A rule that is clear and isn't followed moves closer to where the author works, preferring,
in this order, a lint rule or a CI check, a default in a script or config (as the UTC time zone in
`vite.config.ts` is), a column or prompt in the PR template, a line in the author's checks in
[TESTING.md](TESTING.md) → Reviewing a PR's tests. Another sentence in the docs is the last resort.
The owner gets the results in the chat first; from the owner's answers the session writes drafts of
the rule changes (`CLAUDE.md` → Workflow), and only then opens the PR with the table's row.

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
