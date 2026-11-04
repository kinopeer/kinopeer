---
name: test-review
description: Review a pull request's tests against docs/TESTING.md before it merges — the PR's own account of what is covered and why something isn't, the layer of every new or changed test, removed assertions, fakes against the real services, the record a fix/ PR must carry. Use as `/test-review <PR number>` or `/test-review` for the current branch; also when asked whether a PR's tests are "in order", "по системе" or "по правилам".
---

# Test review

This review asks one question: do the PR's tests follow `docs/TESTING.md`? It does not hunt for
bugs in the code (`/code-review` does) and it does not re-run the suite (CI does). Read
`docs/TESTING.md` once per session before the first review; the rules live there, this file is the
procedure. The comment on the PR is in English, like everything on GitHub; a summary in the chat
follows the conversation's language. Code, file paths and quotes stay as they are.

## 1. Start from the PR's description, not from the diff

- With a number: read the PR with `gh api repos/{owner}/{repo}/pulls/<n>` (title, body, labels,
  `head.ref`) and its comments with `gh api repos/{owner}/{repo}/issues/<n>/comments`, or the
  GitHub MCP tools where there is no `gh`. Use the REST API: `gh pr view` goes through GraphQL,
  which Claude Code cloud sessions are refused. Then `git fetch origin <head.ref>` and diff
  `origin/main...origin/<head.ref>`, leaving PNGs out.
  Without a number: the current branch, `git diff origin/main...HEAD` plus uncommitted changes.
- From the **Tests** section take six lists: the tests the author added or changed, with the
  layer named for each and whether it was seen red; **what is declared uncovered and the reason
  given**; the answer to each neighbour (`Neighbours`); the `Mutants` line and what it says of each
  survivor; what was broken by hand (`Broken by hand`); which screenshot baselines changed, why, and
  how each was checked. From a `fix/` PR or the fix of a flaky test
  also take the **Why tests missed it** section (class and action), the linked issue
  (`Closes #n`) and that issue's `test-gap:*` label.
- A declared-uncovered part is reviewed for its reason, not asked for a test. The accepted
  reasons are listed in `docs/TESTING.md` → Choosing a layer → Saying why something is uncovered.
  A reason holds when it names the accepted case and matches the diff: "layout, checked on the
  stand" is fine for a CSS-only change and not for a new branch in a hook. A part of the diff with
  no test and no reason, or with a reason that doesn't hold, is a finding.
- A PR whose description has no Tests section at all gets that as its first finding; keep
  reviewing the diff anyway.
- Look for earlier rounds among the PR's comments (fetched above): those headed
  `Test review, round <n>`. If there are any, this is round n+1 (section 4), and it starts from the
  author's `Fixes for round <n>` comment after it (each finding fixed or declined, the tests for the
  fixes, a merge of `main`). A `Merged main at <sha>` comment after a **ready to merge** is read as
  section 4 says.

## 2. Sort the diff

Group the changed files: production code (`src/` outside tests, `server/*.ts`, `tmdb-proxy/`
outside tests: the folders `scripts/mutants.mjs` mutates), tests
(`*.test.ts(x)`, `e2e/`), shared test data (`src/test/`, `server/test/`), baselines, config
(`vite.config.ts`, `playwright*.config.ts`, `.oxlintrc.json`, `tsconfig*.json`, CI) and docs. Each
group has its own checks below; a PR without production changes skips A, except for a branch in a
script or a workflow (whether to install, whether to deploy), which is behavior (`docs/TESTING.md`
→ Saying why something is uncovered → No behavior).

## 3. Checks

Every finding names the file and line, quotes the rule from `docs/TESTING.md` it breaks, and says
what to change. Open the files you cite; a test named in the PR as covering something is read, not
trusted.

- **A. Every change is covered or explained.** For each new behavior, changed branch or new error
  path in production code, find the test in the diff that asserts it (grep the test files for the
  symbol or the user-visible text), on the lowest layer that sees it (the table in Choosing a
  layer). Error paths are changes too: a status mapped to a message, a `.catch`, an action
  disabled offline or while busy, a fallback for older stored data. Each place that wires a shared
  component needs its own step; "same code as in X" isn't *covered already*. A new or changed
  route that a client in `src/api/*` calls needs a test in `server/integration/`, and its service's
  fake the new request, in the same PR; a route no client calls needs its layer-4 test. Ask the
  neighbours of the change too (`docs/TESTING.md` → Choosing a layer: another place, later,
  meanwhile, the next poll, the edges), and check the PR's `Neighbours` lines against them: one left
  blank, or answered with a test that doesn't run that case, is a finding. Where you can, break the
  code for exactly that case and see whether the named test fails: a green one doesn't answer it
  (#237, #244, #248, #250). Missing → check the Tests
  section's reasons (step 1) → otherwise a finding. A bug `/code-review` finds in the PR's own change
  is a finding here too, in the same round, as one finding with the bug: the test that should have
  caught it was missing. Don't leave it to the next round.
- **B. Nothing is lost.** For every deleted `it(...)` or deleted assertion, name the test on the
  same or a lower layer that still asserts it, and open it to see that it does. None → finding,
  unless the behavior was removed on purpose and the PR's What and SPEC's decision log name it. In
  Playwright, an assertion that also waited for a state the screenshot needs (a text that appears
  after its own request, such as the sidebar's qBittorrent card) is a step, not a duplicate:
  removing it makes the screenshot flaky → finding.
- **C. The right layer.** A screen test that re-asserts a component's own behavior (a menu's
  Escape and focus, a popover's click outside), a pure function's rules (the sort's order, parsing)
  or a client–server contract (shapes and status codes, which belong in `server/integration/`) →
  finding: keep one step, drop the assertions. A jsdom assertion about layout (`parentElement`,
  the order of sections, "stays at the top") → wrong layer, it belongs to a screenshot. A layer
  named in the PR that isn't the table's number and name (a sheet in `src/screens/` called layer
  2, "unit", "integration" for a jsdom test, "5, screenshot") → finding. A check that reads a
  source file as text (a stylesheet's tokens, an animation's keyframes) is layer 1 wherever it sits.
- **D. Behavior, not implementation.** A test that breaks `docs/TESTING.md` → Choosing a layer →
  What a mock may be asked, What a test may count, besides mocks (pending timers, `parentElement`
  for an attribute), or Roles and names, not classes → finding.
- **E. Fakes and fixtures stay true.** A new or changed answer in `server/test/fakes.ts` is
  compared with the middleware it imitates (`server/*.ts`: status codes, `error` codes, body
  shapes) and with what the real service does; a mismatch is `fake-drift` in the making. Shared
  fakes change by addition unless the PR says why; a fake that gains behavior names the service
  version in its comment. A literal that copies a fixture instead of importing it, and a fixture
  the baselines render from changed without re-rendering them → findings.
- **F. Hygiene.** Real timers or sleeps, `waitFor` with a `timeout` above the default, a listener
  on `document` or `window` or fake timers removed at the end of `it` instead of in `afterEach` or
  `onTestFinished`, a spy made at the top of a file or in `beforeAll` (Vitest puts spies, globals
  and env back before each test: `docs/TESTING.md` → What a test puts in place), a second
  copy of a literal or a wrapper in one file, an index-based query
  for an element that has a name of its own (`getAllByRole('button')[1]`; an index is fine when the
  position is what the test says, as the first row after a sort or the current title first),
  an absence asserted by counting the others instead of by name, test data with a behavior the test
  isn't about (a `recheck` given a hold it never has in the app), a flush through
  `setTimeout(resolve)` (a real timer, even at no delay),
  `getByText` where a role and name exist, and an error or confirmation found by text or by a bare
  `findByRole('alert'|'status')` with `toHaveTextContent` instead of `{ name: saying(text) }` from
  `src/test/render.tsx`, a class selector for a decorative image whose `src` alone finds it, `{
  force: true }` on a hidden control, `.skip`/`.only`/`.todo`/`fixme`, `retries` above 0, a test
  title or a comment on an assertion that says more than the body checks → findings.
- **G. Baselines.** Each changed or new PNG is listed in the PR with what changed, why, and how it
  was checked: the diff in `test-results/` looked at, re-rendered with `--update-snapshots=all`
  (a change under the threshold), or new and opened. The listed reason matches the screen. Open
  each new baseline yourself: it shows the state its test name promises. A new screen, sheet,
  dialog or a state with its own layout that has no baseline, only "checked on the stand" → finding.
- **H. Docs match the code.** A claim the PR adds to `docs/TESTING.md` or `CLAUDE.md` (a comment
  that exists, a command, a number, a file) is checked against the diff and the tree, and so is one
  the diff makes stale, a sentence saying which test owns a statement above all: grep `docs/`,
  `CLAUDE.md` and `README.md` for each number or name the diff changes (a width, a version, a count).
  A list in the docs that the change adds to gains the new item (the screens in `docs/TESTING.md` →
  Screenshot tests, SPEC's decision log, newest first, the blind spots: any PR that meets a blind
  spot the table doesn't name adds its row), and a manual check the PR adds says what has to be in
  place for it to pass. How a paragraph wraps is not a finding.
- **I. A `fix/` PR carries its record.** So does the fix of a flaky test. The issue is linked and
  labelled `test-gap:<class>`; a bug's fix says the new test was red before the fix, and a flaky
  test's fix says how often the test failed and how many runs it now passes; the class fits the
  story in the PR; "what changes so this class is caught" names a concrete change, not a wish.
  Missing or vague → finding.
- **K. Each test can fail.** The Tests table says what was broken to see each new or changed test
  red, once per claim of its title and of each comment on its assertions, and the
  `Mutants` line accounts for each survivor in CI's comment on the PR (the one at the commit the
  round reviews), an `equivalent` with a reason you agree with; missing either, or a test you can see would
  stay green with its behavior removed, → finding. CI mutates every push to a ready PR's head, so
  its comment is at the commit the round reviews (a survivor new since the `Mutants` line is
  accounted for in the author's `Fixes for round <n>`): while the run is going, wait for it. Run `npm
  run test:mutants` locally only when no comment can come for that commit (Actions out of minutes,
  the job failed), and say so in the round. An `equivalent` that only a test's own reset keeps alive isn't one. The
  `Broken by hand` line covers what the changed lines hold of the list in `docs/TESTING.md` → A test
  that can fail (a dependency array, one operand of a condition, `&&` chains included, a selector's
  alternatives, which value a guard reads, a prop passed down); one of them left out, where you can see a test would
  stay green with it broken, → finding. Read each new test for the shapes in `docs/TESTING.md` → A
  test that can fail.

## 4. Report

Findings first, most severe first: blocking (B, D, E with a drift, I missing, K, A without a
reason), then should-fix (C, F, G, H), then nits. Each defect is one finding under one check:
a new sheet or state without a baseline is G, not also A. One line per finding: `file:line`, the defect,
the rule (a few words from `docs/TESTING.md`), the fix, and the tag `[<check> · <rule>]`: the
check's letter (there is no J: coverage left the checks on 2026-11-03, and its rule stays in
`docs/TESTING.md` → Coverage), and `clear` when the rule says it plainly, `gap` when no rule covers it or the rule
reads both ways, `conflict` when `docs/TESTING.md` and this skill (or the PR template, or
`CLAUDE.md`) disagree. Say in one line what a `conflict` is between, so the next docs PR can settle
it. The tags feed the retro (`docs/TESTING.md` → Improving the system); tag honestly, a `gap` is
not the author's fault.

Then one line with the `/code-review` run on the same commit: `Code review at <short sha>: <n>
findings`, or `no findings`; its findings themselves stay in its own inline comments. Then one
verdict line: **ready to merge** or **needs changes**, with the count per severity and the commit
both reviews saw, `**Verdict: ready to merge** at <short sha>`: the PR merges only on a posted
"ready to merge" at its current head. A commit of the PR's own after it needs another round; a
merge of `main` needs one only when it reaches the PR's own lines, and otherwise the author's
`Merged main at <sha>` comment carries the verdict over (`docs/TESTING.md` → Reviewing a PR's
tests). Add
"retro due" to it when ten or more merged PRs are missing from the retro table in
`docs/TESTING.md` → Improving the system (list the merged PRs since that table's last date and
take out the ones its rows name).
Nothing else: no summary of the PR, no praise, no repeat of what the PR description already says.
On a PR, post the report as one comment headed `Test review, round <n>`:
`gh api repos/{owner}/{repo}/issues/<n>/comments -F body=@report.md`, or the GitHub MCP tools.
Post every round, also when the review runs in a side session: a report left in a chat is invisible
to whoever merges and to the retro. If posting is refused, say so in the chat, so the merge waits
for it. Hand the blocking and
should-fix findings to the PR's author (a session or a person): point them to the posted round.

**Round 2 and later**, once the author posts `Fixes for round <n>`, or a commit of the PR's own
lands after a **ready to merge**: start from that comment, check every line flagged in the previous round, and run all the checks on every
test the PR's own diff (`origin/main...HEAD`) adds or changes since then, since a test written to
answer a finding is a new test. Tests a merge of `main` brought were reviewed in their own PRs. A
merge that reaches the PR's own lines (`docs/TESTING.md` → Reviewing a PR's tests) gets a round
over what it changed of them; one that doesn't, with the author's `Merged main at <sha>` comment
saying so, gets no round. New
findings are tagged like the first round's; one
still open from an earlier round is listed as `still open (round <n>)` with no tag, so the retro
counts it once. Repeat until the verdict is **ready to merge**.
