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
| [The checks guard](#the-checks-guard) | Being adopted: it marks and doesn't block yet (#366) | A script CI runs on every PR, which writes into the PR what in it weakens the checks or changes existing ones |

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
  - a path filter on a workflow's trigger (`paths`, `paths-ignore`), so it runs for fewer changes.
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
- Any change to `scripts/guard/`, `.github/workflows/guard.yml` or this file.

**For a second review**: a change to an existing check that a script can't judge.

- Any other change to `checks.json`: a threshold raised, an entry removed from an exclusion list, a
  key the guard has no rule for.
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

### The thresholds and the exclusion lists

They sit in `checks.json`, as data, so that the guard compares them exactly: `vite.config.ts` reads
from it what coverage measures and its thresholds, `stryker.config.mjs` the mutators left out,
`scripts/mutants.mjs` the folders mutated and the files in them that aren't production code. A new
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
For now it only marks: the job passes whatever it finds.

The lists of the tests that ran come from a job of their own, `tests`, which the `guard` job waits
for. It installs and runs both sides, the commit the branch left `main` at and the branch's head:
the Vitest tests with the JSON reporter, since only a run has a table's every row as a test and
knows a skipped one, and Playwright's `--list` for the screenshot tests and the smoke journeys,
which needs no browser. A failing test is still a test that ran; CI's own jobs fail for it. The
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
- Whatever reading YAML line by line gets wrong: it finds `run:` and `uses:` keys and the lines
  indented under a block, and knows nothing of anchors or of a command built by an expression.
- A change to `guard.yml` that stops the script from running or from being `main`'s copy: the
  workflow runs as the PR has it, so the mark for the owner comes from the changed steps, if they
  still make it.
- Anything written on purpose to get past it. Every session works under the owner's GitHub account,
  so the guard protects against forgetting, not against forging.

Those are the reviews' to catch (`TESTING.md` → Reviewing a PR's tests).

### Its own tests

They sit next to it: the signs as pure functions in `scripts/guard/signs.test.ts`, the reading of
a test file in `assertions.test.ts` and the comparison of the tests that ran in `tests.test.ts`
(layer 1), the reading of a branch and of the reports' folders in `scripts/guard/guard.test.ts`,
over a git repository made in the test (layer 4). Stryker mutates the guard as it does the app's
code.
