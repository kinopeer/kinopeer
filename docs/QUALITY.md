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
  path added to `ignorePatterns` (`.oxlintrc.json`).
- A CI step removed, so that its workflow has fewer steps than before, or a workflow removed
  (`.github/workflows/`). An action's version isn't part of the step, so a bump isn't a change.
- An npm script removed (`scripts` in the root `package.json`): the step that called it checks
  nothing.
- In a line the branch adds:
  - test retries: Playwright's `retries` with anything but 0, Vitest's `retry` with a number, an
    object or the environment, `--retry` and `--retries`. Looked for in the tests, the configs in
    the root, the workflows and the scripts, not in the app's code, which has retries of its own;
  - a screenshot tolerance: `maxDiffPixels`, `maxDiffPixelRatio` or `threshold`, in `e2e/` and the
    Playwright configs;
  - a check turned off in the code: `oxlint-disable` and `eslint-disable` (oxlint obeys both),
    `v8 ignore`, `c8 ignore` and `istanbul ignore`, `Stryker disable`, `@ts-ignore`,
    `@ts-expect-error` and `@ts-nocheck`, in any file but a doc;
  - a test skipped in `e2e/`: `test.skip`, `test.fixme` and the same on `test.describe`. In the
    Vitest tests oxlint stops them, and `test.only` fails CI by Playwright's `forbidOnly`;
  - a CI step that can fail without failing the run: `continue-on-error`, or `|| true` in a
    workflow's command;
  - a path filter on a workflow's trigger (`paths`, `paths-ignore`), so it runs for fewer changes.
- `checks.json`, `.oxlintrc.json` or `package.json` that is no longer a JSON object the guard can
  read, and `checks.json` or `.oxlintrc.json` removed.
- Any change to `scripts/guard/`, `.github/workflows/guard.yml` or this file.

**For a second review**: a change to an existing check that a script can't judge.

- Any other change to `checks.json`: a threshold raised, an entry removed from an exclusion list, a
  key the guard has no rule for.
- Any other change to `.oxlintrc.json`: a rule's options, a new rule that only warns, a key the
  guard has no rule for.
- A CI step whose command changed while its workflow kept as many steps, and an npm script
  changed: a script can't tell whether either does less.
- A condition added to a CI step or job (`if:`): most are fair, as `if: always()` on a summary is.
- `checks.json`, `.oxlintrc.json` or `package.json` whose copy on `main` the guard can't read, so
  that it has nothing to compare the branch's with.

A new sign goes into `scripts/guard/signs.ts` with its tests and into this list, in one PR, which
goes to the owner as any change to the guard does.

### The thresholds and the exclusion lists

They sit in `checks.json`, as data, so that the guard compares them exactly: `vite.config.ts` reads
from it what coverage measures and its thresholds, `stryker.config.mjs` the mutators left out,
`scripts/mutants.mjs` the folders mutated and the files in them that aren't production code. A new
threshold, budget or exclusion list goes there too, not into the config that uses it, where the
guard wouldn't see it move.

### How it runs

**In CI** the `guard` job runs on every PR (`.github/workflows/guard.yml`). It runs `main`'s copy of
the script, not the branch's, so a PR that changes the guard is still read by the guard it found;
only the PR that added the guard ran its own. It reads the branch through git and runs none of its
code. What it finds goes into the job's summary and into one comment on the PR, which the job
edits in place on every push; a fork's PR and Dependabot's get the summary alone, since their token
can't comment. For now it only marks: the job passes whatever it finds.

**Locally** `npm run guard` prints the same report for this checkout's commits against
`origin/main` (`--base` and `--head` name others), so the author sees the marks before pushing. It
reads commits, not the working tree, and says so when there are uncommitted changes.

### What it doesn't see

- A check weakened from inside: a config that stops reading `checks.json`, an assertion rewritten
  to check less, a test that lost its rows.
- A trigger narrowed in a workflow other than by a new path filter (a branch or an event removed,
  a path taken out of an existing filter).
- Whatever reading YAML line by line gets wrong: it finds `run:` and `uses:` keys and the lines
  indented under a block, and knows nothing of anchors or of a command built by an expression.
- Anything written on purpose to get past it. Every session works under the owner's GitHub account,
  so the guard protects against forgetting, not against forging.

Those are the reviews' to catch (`TESTING.md` → Reviewing a PR's tests).

### Its own tests

They sit next to it: the signs as pure functions in `scripts/guard/signs.test.ts` (layer 1), the
reading of a branch in `scripts/guard/guard.test.ts`, over a git repository made in the test
(layer 4). Stryker mutates the guard as it does the app's code.
