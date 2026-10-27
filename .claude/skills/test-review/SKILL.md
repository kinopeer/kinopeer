---
name: test-review
description: Review a pull request's tests against docs/TESTING.md before it merges — the PR's own account of what is covered and why something isn't, the layer of every new or changed test, removed assertions, fakes against the real services, the record a fix/ PR must carry. Use as `/test-review <PR number>` or `/test-review` for the current branch; also when asked whether a PR's tests are "in order", "по системе" or "по правилам".
---

# Test review

This review asks one question: do the PR's tests follow `docs/TESTING.md`? It does not hunt for
bugs in the code (`/code-review` does) and it does not re-run the suite (CI does). Read
`docs/TESTING.md` once per session before the first review; the rules live there, this file is the
procedure. Report in the language of the conversation; code, file paths and quotes stay as they are.

## 1. Start from the PR's description, not from the diff

- With a number: `gh pr view <n> --json title,body,labels,headRefName`, then
  `git fetch origin <headRefName>` and diff `origin/main...origin/<headRefName>`, leaving PNGs out.
  Without a number: the current branch, `git diff origin/main...HEAD` plus uncommitted changes.
- From the **Tests** section take three lists: the tests the author added or changed and the
  layer named for each; **what is declared uncovered and the reason given**; which screenshot
  baselines changed and why. From a `fix/` PR also take the **Why tests missed it** section (class
  and action), the linked issue (`Closes #n`) and that issue's `test-gap:*` label.
- A declared-uncovered part is reviewed for its reason, not asked for a test. The accepted
  reasons are listed in `docs/TESTING.md` → Choosing a layer → Saying why something is uncovered.
  A reason holds when it names the accepted case and matches the diff: "layout, checked on the
  stand" is fine for a CSS-only change and not for a new branch in a hook. A part of the diff with
  no test and no reason, or with a reason that doesn't hold, is a finding.
- A PR whose description has no Tests section at all gets that as its first finding; keep
  reviewing the diff anyway.

## 2. Sort the diff

Group the changed files: production code (`src/` outside tests, `server/*.ts`), tests
(`*.test.ts(x)`, `e2e/`), shared test data (`src/test/`, `server/test/`), baselines, config
(`vite.config.ts`, `playwright*.config.ts`, `.oxlintrc.json`, `tsconfig*.json`, CI) and docs. Each
group has its own checks below; a PR without production changes skips A.

## 3. Checks

Every finding names the file and line, quotes the rule from `docs/TESTING.md` it breaks, and says
what to change. Open the files you cite; a test named in the PR as covering something is read, not
trusted.

- **A. Every change is covered or explained.** For each new behavior, changed branch or new error
  path in production code, find the test in the diff that asserts it (grep the test files for the
  symbol or the user-visible text), on the lowest layer that sees it (the table in Choosing a
  layer). Missing → check the Tests section's reasons (step 1) → otherwise a finding.
- **B. Nothing is lost.** For every deleted `it(...)` or deleted assertion, name the test on the
  same or a lower layer that still asserts it, and open it to see that it does. None → finding. In
  Playwright, an assertion that also waited for a state the screenshot needs (a text that appears
  after its own request, such as the sidebar's qBittorrent card) is a step, not a duplicate:
  removing it makes the screenshot flaky → finding.
- **C. The right layer.** A screen test that re-asserts a component's own behavior (a menu's
  Escape and focus, a popover's click outside), a pure function's rules (the sort's order, parsing)
  or a client–server contract (shapes and status codes, which belong in `server/integration/`) →
  finding: keep one step, drop the assertions. A jsdom assertion about layout (`parentElement`,
  the order of sections, "stays at the top") → wrong layer, it belongs to a screenshot.
- **D. Behavior, not implementation.** Assertions on a mock's call payload that a lower layer
  owns (the shape `saveMatches` is called with is `titleMatches.test`'s), on CSS classes anywhere
  but a design-system component's own test, on call counts of another module, or
  `expect.anything()` standing in for a real check → finding.
- **E. Fakes and fixtures stay true.** A new or changed answer in `server/test/fakes.ts` is
  compared with the middleware it imitates (`server/*.ts`: status codes, `error` codes, body
  shapes) and with what the real service does; a mismatch is `fake-drift` in the making. Shared
  fakes change by addition unless the PR says why; a fake that gains behavior names the service
  version in its comment. A literal that copies a fixture instead of importing it, and a fixture
  the baselines render from changed without re-rendering them → findings.
- **F. Hygiene.** Real timers or sleeps, `waitFor` with a `timeout` above the default, a spy
  restored inside `it` instead of `afterEach`, a stubbed global left in place, index-based queries
  (`getAllByRole(...)[1]`), `getByText` where a role and name exist, `{ force: true }` on a hidden
  control, `.skip`/`.only`/`.todo`/`fixme`, `retries` above 0, a test title that no longer says what
  the body does → findings.
- **G. Baselines.** Each changed or new PNG is listed in the PR with what changed and why, the PR
  says the diffs in `test-results/` were looked at, and the listed reason matches the screen. A
  new baseline is opened and looked at: it shows the state its test name promises.
- **H. Docs match the code.** A claim the PR adds to `docs/TESTING.md` or `CLAUDE.md` (a comment
  that exists, a command, a number, a file) is checked against the diff and the tree.
- **I. A `fix/` PR carries its record.** The issue is linked and labelled `test-gap:<class>`; the
  PR says the new test was red before the fix; the class fits the story in the PR; "what changes so
  this class is caught" names a concrete change, not a wish. Missing or vague → finding.
- **J. Coverage.** `coverage.thresholds` in `vite.config.ts` are not lowered; a PR that says the
  totals fell gives a reason in its Tests section.

## 4. Report

Findings first, most severe first: blocking (B, D, E with a drift, I missing, A without a reason),
then should-fix (C, F, G, H, J), then nits. One line per finding: `file:line`, the defect, the rule
(a few words from `docs/TESTING.md`), the fix. Then one verdict line: **ready to merge** or **needs
changes**, with the count per severity. Nothing else: no summary of the PR, no praise, no repeat of
what the PR description already says. Hand the blocking and should-fix findings to the PR's author
(a session or a person); when they come back fixed, re-check only those lines.
