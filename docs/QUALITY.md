# Quality

Kinopeer's code is written and reviewed by AI agents. Its quality is held by three things: the
automated checks, independent reviews by sessions that didn't write the change, and the owner's
look at how the app behaves. This file says which parts of that system are in force here, and it
owns the rules of the checks guard. How the tests are organized and how a PR's tests are reviewed
is in [TESTING.md](TESTING.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

Any change to this file goes to the owner: the guard marks it.

## Components

Only what is on, being adopted, or declined with its reason; plans aren't listed.

| Component | State | What it does |
| --- | --- | --- |
| [The checks guard](#the-checks-guard) | On since 2026-11-12 (#366): its check is red while a PR lacks the records its marks call for, and is among `main`'s required checks | A script CI runs on every PR, which writes into the PR what in it weakens the checks or changes existing ones, and what record each of the two calls for |
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

Two kinds of change, by what each calls for before the PR merges.

**For the owner**, to approve with a reason: a weakening of the checks, or a change to the guard
or its rules.

- A coverage threshold lowered or removed, a path added to what coverage leaves out, or one removed
  from what it measures (`coverage` in `checks.json`).
- A mutator added to those Stryker leaves out, a pattern added to the files it doesn't mutate, or a
  folder removed from those it does (`mutants` in `checks.json`).
- A budget raised, removed or no longer a number (`budgets` in `checks.json`, where more is
  weaker). A budget lowered isn't marked: it checks more.
- A lint rule removed, turned off or downgraded, at the top level or in an override; a rule turned
  off that the config didn't name before, since it may have been on by default; a plugin removed; a
  path added to `ignorePatterns` (the root `.oxlintrc.json`).
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

**For a second review**: a change to an existing check that a script can't judge.

- Any other change to `checks.json`: a threshold raised, a new budget, an entry removed from an
  exclusion list, a key the guard has no rule for.
- Any other change to `.oxlintrc.json`: a rule's options, also when its severity went up with
  them; a new rule that only warns; a key the guard has no rule for.
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
tests assert and which of them ran) with its tests and into this list, in one PR, which
goes to the owner as any change to the guard does. The list is never whole, and isn't meant to be:
the guard is a tripwire for the cheap, known ways around a check, and the reviews catch the rest.
A way around that a review finds goes into [What it doesn't see](#what-it-doesnt-see); it joins
the list through the retro (`TESTING.md` → Improving the system), once it has been met in a PR or
costs one line.

### What a marked PR needs

The guard's marks are two lists, for the owner and for a second review. While a list isn't closed
by a record, the `guard` check is red; a PR without marks has it green.

**The code of a list.** Each list has a code: a short hash of its marks (what each calls for, its
file and what it says, without line numbers) and of the marked files as they are at the branch's
head. A record names the code, so it holds while the marks and the marked files are the same:
once a marked file or the list itself changes, the code is another and the list needs a new
record. A push that touches neither (a doc, `CHANGELOG.md`, a merge of `main` in other files)
leaves the record in force, unless a mark's own text carries a count the push changes: "fewer
tests run" names both sides' totals, so a merge of `main` that brings a test gives that list
another code.

**A record** is a comment on the PR whose first line is one of three; the rest is free text:

- `**Second review <code>: sound**`: the second review found no weakening among the list's marks;
- `**Second review <code>: weakening**`: it found one, or couldn't decide;
- `**Owner's approval <code>:** <reason>`: the owner approves, with the owner's reason on that
  line, in English.

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
jump, its issue named beside it in TESTING, and the fix lowers it: today Downloads and the
torrent's drawer on desktop (0.02, the header's tools moving as the totals come in, #405), a title's
and a series' page on desktop (0.02, the hero's backdrop fade, #406), and the releases at
`desktop-rail` (0.04) and `desktop-1280` (0.03), the filter bar wrapping to a second line once the
filters land (#400). A budget is one number for both orders of a screen, so where a carried jump
shows in one order only, a new jump as large passes in the other; these read the same in both
orders but the title's and the series' page (0.0109 and 0.0138), so the room under them is the
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
can't decide on an element (text over an image, say) is "incomplete" and isn't counted. axe's
`target-size` asks for 24px; the 44px of `CLAUDE.md` → Conventions has no check of its own and stays
the reviews' (decided on 2026-11-14: a check of its own would need exceptions, such as links in
text, for little gain). axe reads the whole page, also for a screenshot of one element, and after
the screenshot, so nothing it does on the page shows in it.

**Built into the screenshot.** The specs take `test` and `expect` from `e2e/test.ts`, whose
`toHaveScreenshot` takes the screenshot and then has axe read the page, as do those of
`expect.soft` and `expect.configure`; oxlint refuses `test` and `expect` from `@playwright/test` in
`e2e/**/*.spec.ts` (`.oxlintrc.json`). So a new screenshot can't be taken without the read, which a
helper called beside it would leave to whoever writes the test.

**Each state has its budgets**, under `budgets.accessibility` in `checks.json`: by spec (its file
without `.spec.ts`), then screenshot (its name without `.png`), then axe's rule, the count of
elements that break the rule there (`downloads.select-list-dark-ru.color-contrast`). A rule a state
doesn't name is 0, and a state where axe finds nothing has `{}`. Two tests that take the same
screenshot share its budgets, as they share its baseline. A screenshot's name has no dot but its
`.png`, nor has its spec's but its `.spec.ts`: the checks guard reads a budget by its keys joined
with dots ([What it doesn't see](#what-it-doesnt-see)).

**Exact, not within a margin.** The tests run on mocked answers with the clock frozen, so a state
is the same every run, and so is what axe finds in it: four whole runs in a row in Docker gave the
same counts in every state, and CI's run the same as Docker's on a Mac (the same image). So the
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
that aren't a list of words). And `e2e/accessibility.spec.ts` fails on a budget for a screenshot
with no baseline in `e2e/__screenshots__/`, or a baseline without a budget: every screenshot the
specs take has a baseline, since one without fails, so the baselines stand for the list of states.
A baseline left behind by a test that was removed keeps its budgets, which no test then reads.

**Over a budget**, fix what axe names. Raising a budget is a weakening: it is the owner's decision,
and the checks guard marks a budget raised, removed or no longer a number for the owner, and any
change to the tags, which it reads as a budget that isn't a number. A new budget, for a new
screenshot or a rule a state didn't break before, goes to a second review; a new state with `{}`
has no number in it, so the guard marks nothing. A budget lowered needs no record. An update of
axe-core (Dependabot's monthly group) may find more or less; its PR then fails the `visual` job, and
the budgets are read again there, a raised one going to the owner.

**What it doesn't see.** Only what the screenshots show: a state no screenshot takes, a hover or a
focus ring but the few the specs set up, the light theme and English but in their few screenshots.
Nothing axe leaves to a person: whether a name makes sense, the order a screen reader reads in,
keyboard navigation and focus (`CLAUDE.md` → Conventions leaves those to each project), how the app
sounds in VoiceOver or TalkBack.

**In CI** it is part of the `visual` job, in the Playwright image the baselines are rendered in.
The reads add about 64 s of test time, about 32 s on the job's two workers: a whole run took 60 s in
Docker on a Mac with them. A failure uploads the Playwright report as the screenshots' do, and each
screenshot's test there has an `axe <spec>/<screenshot>` attachment with every element axe found.

**Its tests**: the rules (the budgets and tags read, a screenshot's state from its name, the
verdict and its report, the budgets without a baseline and the baselines without a budget) are pure
functions in `scripts/accessibility/budget.ts`, tested in `budget.test.ts` (layer 1); coverage
measures the folder and Stryker mutates it. The read itself, in `e2e/test.ts`, and the check of the
baselines, in `e2e/accessibility.spec.ts`, are layer 6, beside the screenshot tests.
