# Testing

How Kinoseed's tests are organized: six layers, each with one job, and how to choose one; what to
do with a bug; what no layer sees; the shared test data and the fake services; coverage and its
threshold; how a PR's tests are reviewed and how review findings change these rules; the
screenshot tests and the smoke journeys. Running and releasing are in
[DEVELOPMENT.md](DEVELOPMENT.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

```sh
npm test                    # layers 1–5 (Vitest), single run
npm test -- --project app   # only the jsdom tests (src/)
npm test -- --project server  # only the server and integration tests (server/)
npm run test:coverage       # the same with coverage and its threshold: a table in the terminal, coverage/index.html
npm run test:mutants        # breaks the lines this branch changes, lists the breaks no test noticed
npm run test:visual         # layer 6: screenshot tests in Docker
npm run test:visual:update  # re-render their baselines
npm run test:smoke          # layer 6: smoke journeys through the production server, no Docker
```

## Layers

| # | Layer | What it checks | What it doesn't | Tool | Where | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pure logic | Parsing release and torrent names, picking a title, filtering and sorting, formatting, the SHA-1 fallback: functions that import no React, DOM or Node APIs | Rendering, the network | Vitest | `*.test.ts` next to the module (`src/releases/`, `src/torrents/`, `src/lib/`, `server/json.ts`) | `npm test` |
| 2 | Components and generic hooks | A shared component renders its props with the right roles and names and reacts to input; a hook that knows nothing of the app's data does its job in a DOM (`useIsDesktop`, `useHeightVar`, `useScrollRestoration`, the theme) | Layout and looks, which jsdom has none of; the app's data | Vitest + Testing Library, jsdom | `src/components/*/*.test.tsx`, the hooks in `src/lib/`, `src/theme/` | `npm test` |
| 3 | Screens, stores and clients | A screen or a user flow with the API clients mocked (`vi.mock('../api/…')`): what it shows for a state, what it sends, where it navigates. A hook or a store that holds the app's data, with the clients mocked. An API client with `fetch` stubbed: the request it builds and how it reads each answer, errors included | Real HTTP, the server, layout | Vitest + Testing Library + user-event, jsdom | `src/screens/*.test.tsx` (sheets and dialogs included), `src/App.test.tsx`, the hooks and stores in `src/session/`, `src/torrents/`, `src/settings/`, the clients in `src/api/*/` | `npm test` |
| 4 | Server | Each middleware under `server/` against fake qBittorrent, TMDB and Prowlarr servers started in the test: routing, headers, what reaches the service and what comes back | Browser code | Vitest, Node (`server` project) | `server/*.test.ts`, fakes in `server/test/fakes.ts` | `npm test -- --project server` |
| 5 | Integration | The real clients in `src/api/*` calling the real `kinoseedServer()` in front of the fakes: both ends of each route agree on paths, bodies, cookies and errors, and the flows that cross several routes (login, adding a release, matches) | Rendering; a server without a route (the SPA fallback), which stays in the client tests | Vitest, Node | `server/integration/*.test.ts`, the stand in `server/test/integration.ts` | `npm test -- --project server` |
| 6 | Browser | How the screens look: the built app in Chromium against baseline PNGs, with every server route mocked (screenshot tests). And four smoke journeys through the real production server behind a proxy that wants a cookie, with the services faked: the browser and the server together (smoke journeys) | Behavior, which the layers above cover faster | Playwright in Docker; Playwright on the host | `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`; `e2e/smoke/*.smoke.ts`, the stand in `e2e/smoke/stack.ts` | `npm run test:visual`; `npm run test:smoke` |

Layers 1–5 run on every `npm test` in two Vitest projects (`vite.config.ts`): `app` is jsdom with
`src/test-setup.ts` (jest-dom matchers, the interface language reset to English, Testing Library's
cleanup, a no-op `window.scrollTo` since jsdom only logs "not implemented" for it); `server` is
plain Node for `server/**/*.test.ts`, the integration tests included. Tests sit next to the code as
`*.test.ts(x)` and query by role and accessible name. The service worker is the one exception to
the layers: its routing rules are plain logic in `src/pwa/swRoutes.ts` (layer 1), and
`src/sw.test.ts` is a smoke test of `src/sw.ts` with workbox mocked, compiled with the worker's
`tsconfig.sw.json` rather than the app's.

A test in `src/screens/` is layer 3, a sheet or a dialog included: layer 2 is only what knows
nothing of the app's data. A PR names a test's layer by its number and its name in this table
("layer 3, screens, stores and clients"); *unit*, *component* and *integration* aren't layer names
here, and a layer named wrong keeps the review from checking that it's the lowest one.

## Choosing a layer

A change is every new behavior and every new branch, error paths included: a status mapped to a
message, a `.catch` that swallows or reports, an action disabled offline or while busy, a fallback
for data an older version stored. Each one gets a test or an accepted reason
([below](#saying-why-something-is-uncovered)), like any other branch.

Most bugs that reach `main` sit next to the state a PR changed, not in it. So go through the
neighbours of a change, and answer each that applies with a test or a reason:

- **Another place:** what else shows or sends the same thing, on the phone and on desktop, in the
  drawer and on the page (#180, #182)? Does it see this state, or does it send the request again?
- **Later:** what if the sheet was closed, the screen left, or the torrent went away or was replaced
  before the answer came (#172, #174, #184)?
- **Meanwhile:** what if the user presses it again, reopens the sheet or types while the request is
  in flight (#171, #186)?
- **The next poll:** does a poll sent before the change undo it (#192)?

One behavior, one layer: every statement about what Kinoseed does lives in exactly one test, on the
lowest layer that can see it. Higher layers meet that behavior only as a step towards the state they
check: a screen test opens the sort sheet to reach a sorted list and doesn't re-check the order's
rules, which `sort.test.ts` owns. A sentence in this file that says which test owns a statement is
a claim like any other: a PR that moves the statement updates the sentence. Pick the layer by what
the statement needs:

| The statement | What it needs | Layer |
| --- | --- | --- |
| `parseRelease` reads 2160p and Dolby Vision from a release name | A function and its input | 1 |
| `Sheet` closes when its `<dialog>` is cancelled with Escape | React and a DOM, no screen around it | 2 |
| Downloads shows the error state, and Try again polls again | A screen with its API clients mocked | 3 |
| The server never forwards the browser's cookies to qBittorrent | The server and a fake service, no browser code | 4 |
| `/prowlarr/download` answers `{ magnet }` the way `src/api/prowlarr` reads it | Both ends of a route: the real client and the real server | 5 |
| The filter bar stays at the top after a scroll | Layout, which jsdom hasn't | 6, a screenshot |
| The qBittorrent session lives on the server only, behind a proxy that wants a cookie | A real browser and the real server together | 6, a smoke journey |

Walk down the middle column: no React → 1; React but no screen's data → 2; a screen's data but no
server → 3; the server but not the browser's code → 4; both ends → 5; layout, a service worker, a
proxy or anything else only a browser does → 6, a screenshot when the question is how it looks and a
journey when it's whether the pieces work together. In doubt, take the lower layer: it runs in
milliseconds, fails with a precise message, and it's the one the layer above leans on.

- **A lower layer already checks it.** Don't repeat it; use it as a step. A screen test that reaches
  a state through sorting trusts the sort; a journey that adds a release trusts the file picker and
  checks only what reached qBittorrent. A duplicate on purpose carries a comment saying what the
  second layer sees that the first can't: the delete journey presses a real Escape in the drawer's
  confirmation although `DownloadsWithDrawer.test.tsx` already sends the `cancel` event, because
  jsdom never turns Escape into `cancel`, and only Chromium shows where the browser's own event and
  React's dispatch meet.
- **What a mock may be asked.** A layer-3 test may assert what it hands off to, and with what
  arguments, when that hand-off is the screen's behavior: an API client or a domain action
  (`addRelease`, `chooseTitle`, `forgetMatches`), a callback prop it reports to (`onSaved`,
  `onClose`), or a browser API it drives (`scrollIntoView`). "Save sends the new category", "Delete
  forgets the match", "a failed save doesn't report success". It asserts a count only when the count
  is the behavior (a duplicate request, nothing sent until…), with `not.toHaveBeenCalled()` or
  `toHaveBeenCalledTimes(n)`, and with a comment saying why the count matters unless the test's name
  already says it. It never asserts calls to anything else (i18n, a hook, a helper), and it doesn't
  re-assert what the action does with those arguments, which the action's own test owns: the shape
  `chooseTitle` saves is `titleMatches.test.ts`'s. An argument the test isn't about may be
  `expect.anything()` when another test in the file asserts it (the options in
  `AddReleaseSheet.test.tsx`'s magnet test), or the test of the shared hook that makes the call (a
  releases search's options are `useReleases.test.ts`'s); standing in for the argument the test's
  name is about, it hides the check.
- **Roles and names, not classes.** Tests find elements by role and accessible name
  (`getByRole('button', { name: 'Удалить' })`), so a test fails when the behavior changes, not when
  a stylesheet does. A class is the point in a layer-2 test of a design-system component (`Button`,
  `IconButton`, `Dialog`): their classes are the contract with their CSS, so
  `toHaveClass('ks-btn-primary')` is what such a test is about. Elsewhere a class is asserted only
  where the class itself does what the test says and no role or attribute shows it, with a comment
  saying what it does: the cut of a clamped text (`is-clamped`, `ks-clamp2`: the button's
  `aria-expanded` says whether it's open, the class is what cuts it), `is-on` on the tab highlighted
  for the page behind a drawer, or the root class that tells the sidebar from the tab bar, which
  share one role and name. A decorative image has no role: it is found by its `src`
  (`img[src="…"]`), or by its frame's class, with a comment, where another image shares the `src`
  (the title page's poster and backdrop). Errors, confirmations and other live messages are found by
  their `alert` or `status` role, which is also what a screen reader announces, and their text
  through `saying()` from `src/test/render.tsx`, as the query's `{ name: saying('Torrent deleted')
  }`. A string matches the whole text, as `getByText` does, so "12 torrents deleted" isn't "2
  torrents deleted"; a RegExp is for a part of a longer message. A bare `findByRole('status')` takes
  whatever status is up first (a list that is a status region, an earlier toast), and
  `toHaveTextContent` then matches a part. A toast shown while a sheet, dialog or drawer is open
  moves to the page when it closes, so a step that closes one looks for the toast with
  `findToastOnPage` (`src/test/render.tsx`), which waits until no modal is open: a toast found
  inside the modal is detached by the next assertion, and the test fails only now and then (#190).
  An element with a name of its own is found by it, not by its index in a list
  (`getAllByRole('button')[1]`); an index is for a position the test is about, as the first row
  after a sort or the current title first.
- **Helpers and fixtures.** Data every layer shares is in `src/test/fixtures.ts`, the rendering
  helpers in `src/test/render.tsx`, the fake services in `server/test/fakes.ts`
  ([Shared test data](#shared-test-data)). The second copy of a literal or a helper moves it one
  level up: two tests in a file share a `const` or a wrapper at the top of that file, and a second
  file moves it to the shared place, as `DUNE_TORRENT` did. A service's new behavior is an addition
  to its fake, with a comment on what the real service does and in which version; an inline server
  is only for a test that needs the service to misbehave in one specific way. `vi.mock` stays in each test file on purpose, so a reader sees what the test replaces without
  opening another module.
- **An overlay for one torrent** (a menu, a sheet, a confirmation) is open through
  `useTorrentOverlay`, whose tests own when it's open (closed, its torrent gone, or replaced by
  another with the same hash). Each screen's tests say, for each overlay it opens, that it closes
  when another torrent with the same hash replaces its torrent (`it.each` in
  `DownloadsScreen.test.tsx` and `TorrentScreen.test.tsx`).
- **A sheet that sends a request for one torrent.** It goes through `useTorrentSheet` (built on
  `useTorrentOverlay`), whose own tests own which requests are pending, and which failure a sheet
  keeps and when it's cleared, also with two screens under one `TorrentRequestsProvider`; the store
  itself (`torrentRequests.test.ts`) owns one request per kind and torrent and which watchers get
  the outcome. The feature's hook tests, with its harness, say where the request's outcome goes,
  whether the sheet stayed, was closed or its torrent went away or was replaced (the sheet that sent
  it, one opened again for the same torrent, or a toast), that it isn't sent twice while in flight
  (pressed again, from the sheet opened again, and after another torrent's request started), that a
  sheet opened again starts from what's in flight, and that its fields can't be changed meanwhile.
  `useMoveTorrent.test.tsx`, `useSpeedLimits.test.tsx` and `useTitleChoice.test.tsx` do, with what a
  sheet does with what's in flight alone in its own tests (`SpeedLimitsSheet.test.tsx`,
  `ChangeTitleSheet.test.tsx`).
- **A request that expects a state** (pause and resume, recheck, delete). The store's tests own
  which torrents a request sends, when the state is kept and the poll asked again, the order the
  states apply in, and `withExpected` when the poll has the final word (a torrent taken away
  included); `useMainData.test.tsx` shows the state through the two providers.
  `usePauseResume.test.tsx` owns busy across places, the toast and its key, and a watcher taking the
  outcome. Each place that pauses or resumes gets one test that it goes through the shared requests
  (busy from a request sent elsewhere, or left out of a bulk one), and `App.test.tsx` one step that
  `App` links the requests to its poll. A kind of its own (reannounce, recheck, delete) has its
  hook's test for the same (`useReannounce.test.tsx`, `useRecheck.test.tsx`,
  `useDeleteTorrents.test.tsx`, the state it expects included) and a wiring test per place, as
  above. File priorities keep their state against the files poll instead, so
  `useFilePriorities.test.tsx` owns when it gives way to that poll, besides busy per file and where
  a failure goes.
- **A flaky test is fixed or deleted.** Not retried, not skipped, not marked `fixme`: a retry hides
  the instability and a skip hides the behavior (oxlint refuses `.skip` and `.only`). Both Playwright
  configs run with `retries: 0`, so a screenshot or a journey that fails once fails the job.

### A test that can fail

A test counts once it has been seen to fail, and the breaking starts from the diff, not from the
tests: an author who breaks what their tests cover never reaches the branch they wrote no test for.
Before marking a PR ready, the author does both of these and says so in the PR:

1. **`npm run test:mutants`.** Stryker takes the production lines the branch has committed since
   `origin/main`, breaks them one small change at a time (a condition always true, a body emptied)
   and runs the tests that reach each one. A break no test notices survives, and the report lists it
   by file and line. The PR's `Mutants` line gives the count and says what each survivor is: a test
   was added, an accepted reason ([below](#saying-why-something-is-uncovered)), or equivalent (no
   test could tell it from the original, and why). Stryker leaves plain values alone (a
   `disabled={disabled}`, a provider around a screen, a number, a text) and can't see code that isn't
   there, so a prop passed down still needs breaking by hand and a missing branch is a question for
   the [neighbours](#choosing-a-layer).
2. **Each new or changed test seen red.** Break the code it covers (remove the guard, flip the
   condition, return early), watch the test fail, put the code back, and say so in the Tests table.

CI runs the same (`.github/workflows/mutants.yml`) once per PR head, not on every push: when a PR is
opened ready or marked ready, or when started by hand (`gh workflow run mutants.yml --ref
<branch>`), and posts the survivors on the PR at that commit. They don't fail the job, since an
equivalent mutant would fail it for good; a survivor the PR doesn't account for is a review finding.
When production lines changed after CI's run, or a PR with production lines has no CI comment
(Actions out of minutes), the reviewer runs `npm run test:mutants` locally at the head and says in
the round what it saw; the reviewer doesn't dispatch the workflow.

A test that stays green with the behavior it names removed is a `silent-test` miss in the making.
Three shapes cause most of them:

- **An absence asserted too early.** `queryBy…` is null, `not.toHaveBeenCalled()`,
  `toBeEmptyDOMElement()` prove something only after the same test has seen that the answer it waits
  for arrived (a text the answer renders, the mock's promise resolved); before that they pass on a
  screen that hasn't loaded.
- **Two causes, one test.** A test about one cause keeps the others out: a swipe test about the
  distance uses a slow swipe, so the flick rule can't pass it for the wrong reason.
- **The clock.** Vitest runs in UTC (`env` in `vite.config.ts`), the same on any machine and in
  CI; a test that reads the time pins it with `vi.setSystemTime`, and one about another time zone
  sets it with `vi.stubEnv('TZ', …)` and puts it back with `vi.unstubAllEnvs()` in its `afterEach`
  or `afterAll`, as `browseRows.test.ts` does. A `process.env.TZ` assigned by hand stays for the
  rest of the file.

The Seen red column is the author's word, and the review can only read the tests for these shapes;
the survivors in CI's comment are not.

### Saying why something is uncovered

A change without a test says so in the PR's Tests section, with the reason, and the reason is one
of these:

- **Looks and layout:** CSS, spacing, a token in a screen that already exists; checked on the test
  stand or by a screenshot baseline, and the PR says which and what was looked at. A new screen,
  sheet or dialog gets a baseline instead, and so does a new state whose layout differs from the
  ones covered (an empty or error state with its own arrangement, not only other text).
- **A blind spot:** only a real phone, Umbrel's proxy, a real service version or real time shows
  it ([Known blind spots](#known-blind-spots)); the PR names the spot and, when the checklist has a
  manual check for it, that it was done.
- **Covered already:** a refactor or a move that an existing test still asserts; the PR names that
  test by its `it` title, and the reviewer opens it. It holds only when that test executes this
  very path. Each place that wires a shared component (a second screen that opens the same sheet,
  the phone and the desktop variant of one action) gets a step of its own that proves the wiring:
  the control is there and does the thing. "Same code as in X" isn't a reason.
- **No behavior:** docs, comments, CI and config, types, generated files, a re-export.

"Trivial", "later", "tested manually" without saying what and where, or a reason that doesn't fit
the diff are not reasons: the change gets its test or the PR explains itself better. The review
(`/test-review`, [Reviewing a PR's tests](#reviewing-a-prs-tests)) reads this section first and
checks the reasons before it looks for missing tests.

## When we find a bug

A bug is two defects: one in the code and one in the tests that let it through. A `fix/` PR answers
three questions: why it broke, why the tests didn't catch it, and what changes so this class of miss
is caught from now on. The order of work:

1. **An issue first.** A bug that reached `main`, from the test stand, from Umbrel or from a test under construction
   becomes an issue with the steps and the environment (phone or desktop, HTTP or HTTPS, the
   qBittorrent version, where it was found) before anyone fixes it, so the fix can be checked against
   what was seen and the label below has a place to live. The bug report form
   (`.github/ISSUE_TEMPLATE/bug_report.yml`) asks for all of these; the `test-gap:*` label comes
   later, from whoever finds why the tests missed it.
2. **A red test on the lowest layer that sees it** (the table above), run to watch it fail on `main`.
3. **The fix**, and the test goes green with everything else.
4. **The record** in the PR and on the issue, below.

The test lives where an ordinary test of that behavior would: next to the code, on its layer, named
after the behavior ("stays open when Escape cancels its delete confirmation"). No `regressions/`
folder and no "issue 123" in a test's name; a link to the issue in a comment only where the case
isn't obvious from the name and the code.

**Why the tests missed it** is one of seven classes. Each has a label (`test-gap:<class>`) and an
action besides the test itself:

| Class | What it looks like in Kinoseed | What we do besides the test |
| --- | --- | --- |
| `uncovered` | Nobody sent `cancel` to a confirmation nested in the drawer (#107) | Add the test. A whole module or family of states without tests gets covered, not just the one case |
| `wrong-layer` | A jsdom test asserted that the filter bar "stays at the top", which jsdom can't see | Move the statement to the layer that sees it (a screenshot after a scroll) and delete the old test |
| `implementation` | A screen test's mock answered what the server never sends, so the screen passed against a fiction | Rewrite the test to the behavior the user sees; the contract between client and server goes to layer 5 |
| `fake-drift` | qBittorrent 5.3 answers 401 to a wrong password; the fake still answered `200 "Fails."` | Fix the fake, with a comment on the real behavior and the version it was seen in, and run everything on the fixed fake |
| `environment` | No `crypto.subtle` over plain HTTP; Umbrel's app_proxy wants a cookie on every fetch; the service worker served the old shell | Add the environment to layer 5 or 6 when it's cheap (the smoke stand's proxy is one); otherwise a line in [Known blind spots](#known-blind-spots) and a manual check in `RELEASE_CHECKLIST.md` |
| `silent-test` | A test that passes with the behavior it names removed: no `expect`, a `.skip`, an absence checked before the answer arrived | Fix or delete the test; where oxlint can catch the shape, a rule in `.oxlintrc.json` |
| `flaky` | Not a bug that reached anyone, but a test that fails now and then: a toast found inside a modal that was closing (#190), a screenshot off by a few pixels on one run in CI (#145) | Fix or delete the test; where a helper can take the shape away, add it, as `findToastOnPage` did. The retro counts these apart from escaped bugs |

The record: a **Why tests missed it** section in the PR (the template has it) with the class and
what changes so the class is caught, and the `test-gap:<class>` label on the issue. A PR that fixes
a flaky test carries the same record, whatever its branch prefix; one flake can't be shown red on
demand, so it says how often the test failed and how many runs it now passes. A systemic
finding (a blind spot, a fake that had drifted) also becomes a line in this file, in the same PR.
There is no separate log: the closed issues with these labels are the history.

Once per release, look at the pile ([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before every
release): three bugs of one class since the last release are a problem of the system, not three
accidents. Three `fake-drift` → compare the fakes with the live services on Umbrel by hand; three
`wrong-layer` → the layer rule above reads badly, rewrite it; three `uncovered` in one area → that
area gets a pass over its states, not three more tests; three `environment` → that environment goes
into layer 6; three `implementation` → review the mocks in that area; three `silent-test` → a lint
rule. The same count also runs over review findings, more often:
[Improving the system](#improving-the-system).

Two rules next to this one:

- A bug seen on the test stand or on Umbrel is an issue with the steps and the environment first,
  then a `fix/` branch; not a fix from memory.
- A test that fails during a planned change is not a bug. The test changes only when the new
  behavior is written down in `SPEC.md` or `CHANGELOG.md`; an assertion is never loosened to make it
  pass.

In practice: #107 (Escape in the delete confirmation closed the drawer too) was found by the delete
smoke journey while it was written, filed with the desktop layout and Chromium as its environment
and labelled `test-gap:uncovered`, and fixed in #108 with a red jsdom test in
`DownloadsWithDrawer.test.tsx` first, then the guard in `TorrentDrawer`, `Sheet` and `Dialog`; the
journey now presses the real Escape it had skipped.

## Known blind spots

What no layer sees. Each is either checked by hand before a release ([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
→ Before every release) or knowingly not checked; a bug from one of them is an `environment` miss,
and its fix either adds the environment to a layer or adds a line here.

| Blind spot | What the tests run instead | How it's covered |
| --- | --- | --- |
| A real phone: Safari on iOS, installing the PWA from Share → Add to Home Screen, the standalone window, the on-screen keyboard over a sheet | Chromium at 390×844 in Docker, where a mouse drag and a wheel over the backdrop stand in for a finger (with touch emulation on, so `pointer: coarse` matches) (a sheet dragged closed, the page behind it staying put), and the keyboard's variables set by hand (Chromium opens no keyboard), with `trackKeyboardInset` on layer 2 against a stubbed `visualViewport`, and `holdPage` on layer 2 (a swipe's `touchmove` prevented or not, the field's transform for the frame it gets focus in, or `NAVIGATION_HOLD_MS` after the keyboard's arrows, the body's negative margin from the start of a hold on a modal with a text field), since no layer sees Safari scroll the page to a field (#168) or the layout viewport part from the visual one (#175), or what reaches the screen when the page is pinned (#203, which showed in the installed app and never in the iOS Simulator) | By hand on the owner's phone against `dev-lan` for a PR that changes a phone screen, or in the iOS Simulator's Safari (Xcode), which opens the on-screen keyboard and scrolls the page as a phone does, and the checklist's phone pass before a release. A Safari tab has no top safe area (`env(safe-area-inset-top)` is 0 there), so what sits under the status bar shows only in the app added to the Home Screen. Chrome on Android, which also opens the keyboard over the page, isn't checked |
| Umbrel's real app_proxy and HTTPS with Umbrel's certificate: the login redirect, the cookie's lifetime, the service worker under a certificate the phone had to trust | The smoke stand's proxy, which only refuses a fetch without the cookie, over plain HTTP | The checklist: after the Umbrel package updates, onboarding, a search and an add on the owner's Umbrel |
| The real qBittorrent and Prowlarr: a version that changes an answer | The fakes in `server/test/fakes.ts`, written from qBittorrent 5.3 (401 on a wrong password; `legacy` for the older `200 "Fails."`) and Prowlarr 1.24, with the version in a comment where it matters | Not until someone hits it: then it's a `fake-drift` miss and the fake moves with the service. Three in a release → compare every fake with the live services by hand |
| Plain HTTP without `crypto.subtle`: reading a `.torrent` with the SHA-1 fallback in a real browser | `src/lib/digest.ts` on layer 1 against known digests; every browser test runs on localhost, a secure context, where Web Crypto exists | The checklist: add a release over `http://` on the LAN, where the info hash must still match qBittorrent's |
| TMDB for real: field shapes, missing posters, the language fallback, rate limits | The fake and the fixtures' titles | Only the README screenshots (`npm run screenshots:readme`, with a real key) and the test stand see the real API; nothing compares them, so a change in TMDB's answers arrives as a bug report |
| Real time: the hour before a refused login is retried, the week before a missing torrent's match is forgotten, the hourly cleanup | Fake timers on layer 4 | Not checked for real; the logic is small and the timers are the only difference |

## Shared test data

The fixtures and helpers live in two folders; a test imports what it needs and keeps anything only
it uses next to itself.

- **`src/test/fixtures.ts`:** the data every layer shares. Torrents (`torrent()`, whose byte counts
  follow its `size` and `progress`; `TORRENTS`, `GUESSED`, `DUNE_TORRENT`, `mainData()`), TMDB
  titles as the API returns them (`TITLES`, `page()`, `details()`)
  and as the app's client maps them (`title()`), Prowlarr releases (`release()`, `RELEASES`,
  `DUNE_RELEASES`), the Shōgun torrent's files (`SHOGUN_FILES`, `torrentFiles()`, the `.torrent`
  bytes from `shogunTorrent()`) and `NOW`, the time the screenshot tests freeze the clock at. It is
  pure TypeScript: no React, DOM or Node APIs, only types from `src/api/*/types`, so the jsdom tests
  import it as `'../test/fixtures'`, the server tests as `'../src/test/fixtures.ts'` and
  `e2e/fixtures.ts` re-exports it for Playwright, adding only what needs the browser (the poster
  SVGs, the `.torrent` as a `Buffer`). Every helper takes overrides: when a test needs other
  defaults, it passes them (or wraps the helper, as the Downloads tests do for their 1 GB rows)
  rather than copying the function. The screenshot baselines are rendered from this module, so a
  change to a name, size, date, order or `NOW` re-renders them.
- **`src/test/render.tsx`:** `renderWithRouter(ui, entries)` renders under a `MemoryRouter` at the
  last of `entries`, for screens that read the URL or navigate; `<Where />` rendered next to them
  shows the current path, which `where()` reads back. `saying(text)` matches a live region by its
  text, as the `name` for `findByRole('status')` or `'alert'`. API mocks stay in each test file
  (`vi.mock`, hoisted), so a reader sees what the test replaces without opening another module.
- **`server/test/fakes.ts`:** `listen(handler)` starts a handler on a free port and returns its
  origin, `serve(middleware)` does the same for the middleware under test with Vite's 404 fallback,
  `closeServers()` closes everything in `afterEach`, `bodyOf(request)` reads a body.
  `fakeQbittorrent()` is a qBittorrent with one user that hands out SID cookies, can expire them
  and records the requests past the login; behind the login it serves the fixtures' torrents
  (`/torrents/info`, `/sync/maindata` with a delta after the first `rid`), the trackers, and adding
  (`/torrents/add` is parsed into `added`, `/torrents/files` answers the `files` a test set for a
  hash, `/torrents/filePrio` changes them, `/torrents/start` and `/stop` answer OK). `fakeTmdb()`
  answers the API (a title's details from the fixtures, TMDB's 404 for one it doesn't have, 401 for
  the key `bad-key`), the authentication check (`good-key` passes) and the image host, recording
  what reached it. `fakeProwlarr()` wants its key in `X-Api-Key` (401 otherwise) and answers the
  status check, the indexers' status (`indexerStatus`, none failed by default), a search with the fixtures' releases (their download links carry the key, as
  Prowlarr's do) and a download: the Shōgun `.torrent` for the link `shogun`, a redirect to a magnet
  link for `magnet`, 404 for anything else. A test that needs a service to misbehave in one specific
  way (a hanging download, an answer that isn't a `.torrent`) writes that handler inline with
  `listen`.
- **`server/test/integration.ts`:** the stand for layer 5, below.

## Integration tests

Layer 5 checks the contract between a client in `src/api/*` and the route in `server/` that serves
it, which no other layer sees whole: the screens mock the clients, the client tests mock `fetch`,
the server tests send requests by hand. `startKinoseed()` (`server/test/integration.ts`) starts the
three fakes, a data directory of its own (`mkdtemp`) and the real `kinoseedServer()` with an
environment pointing at them (`QBITTORRENT_URL`, `PROWLARR_URL`, `TMDB_API_URL`, …, logged in to
qBittorrent as admin), chained the way `server/main.ts` chains the routes; `stopKinoseed()` in
`afterEach` closes everything, restores `fetch` and removes the directory. A test passes `env` to
change the environment (a variable set to `undefined` is unset: no login, no Prowlarr, a dead
port), `writableData: false` to make every write fail, and the fakes' options.

The clients call `fetch('/qbt/api/…')` with a path, as in the browser, which Node's `fetch` can't
resolve, so the stand stubs `globalThis.fetch` with an adapter: a request for a path goes to the
stand's origin with the cookies of a jar (what the server or a proxy in front of it set with
`Set-Cookie` comes back as `Cookie`, as `credentials: 'same-origin'` does), and a request for a
full URL, the server's own to the fakes, goes out untouched. It answers nothing itself: every
response is the real server's. The stand records what the server got from the browser
(`received`, with the cookies), keeps a copy of every answer (`responses`, to check that a key or
a password is in none of them) and exposes the stores, so a test can look at what was saved.

The files are one per service (`qbittorrent`, `prowlarr`, `tmdb`, `settings`, `matches`) and
`flows.test.ts` for what crosses several routes: logging in to qBittorrent, adding a release from
Prowlarr's result to a started torrent with files skipped (`src/releases/addRelease.ts` with the
real `readTorrentFile`, which Node runs as is: `crypto.subtle`, `File` and `FormData` are there),
and a guess against the user's choice in the matches. To add a contract, call the client, then check
what the fake saw (`qbittorrent.seen`, `prowlarr.seen`, `tmdb.seen`), what the server answered and
what it saved; a service's new behavior goes into its fake, not inline. The tests wait for nothing
real: `addRelease` gets a `wait` that resolves at once, and the fakes answer at once. A new or
changed route that a client in `src/api/*` calls gets its test here in the same PR, and when the
route reaches a service, that service's fake in `server/test/fakes.ts` learns the new request in the
same PR too, so the client tests and the smoke journeys don't drift from it. A route no client calls
(`/healthz`, the static files, a job) stays on layer 4. The integration tests are typechecked by
`tsconfig.integration.json`, with the bundler's module resolution, since the clients import without
file extensions; the rest of `server/` stays under `tsconfig.node.json`, which checks the `.ts`
imports Node needs.

## Coverage

`npm run test:coverage` runs the Vitest layers with `@vitest/coverage-v8` and prints a table per
file, plus an HTML report in `coverage/` (git-ignored). It measures `src/` and `server/` without the
tests themselves, `src/test/`, `server/test/`, type-only modules and the `index.ts` barrels of
`src/api/*` and `src/components/*`, which only re-export (`vite.config.ts`). CI runs the same in the
`check` job, adds the totals to the job summary (`scripts/coverage-summary.mjs`) and uploads the HTML
report as the `coverage` artifact.

The run fails under a threshold (`coverage.thresholds` in `vite.config.ts`): 95% of lines, 93% of
statements, 93% of functions and 91% of branches, each two points under the totals of 2026-10-29
(97.46, 95.69, 95.24 and 93.56), rounded down. The threshold is a ratchet: when the totals have grown and
stayed there, raise it to two points under them, in the PR that got them there or in one of its own;
never lower it to get a PR through. A PR that lowers the totals says why in its Tests section (a
module left uncovered on purpose, with the reason). The numbers are there to show what a PR leaves
uncovered; the threshold only keeps that from slipping by unnoticed. It applies to the whole run, so
`npm run test:coverage -- --project server` alone fails it: coverage is measured over both projects.

## Lint rules for tests

oxlint runs its `vitest` plugin on the test files (`.oxlintrc.json`): no two tests with the same
title, no `.skip` or `.only` left behind, every test has an `expect`, no test defined inside a
condition.

## Reviewing a PR's tests

Three steps, each by whoever can do it best:

1. **The author checks what doesn't need judgment** before marking the PR ready: `npm run
   test:mutants` with every survivor accounted for and every new or changed test seen red ([A test
   that can fail](#a-test-that-can-fail)), and the Tests section filled in by the template, one row
   per test with its layer, and every uncovered part with its reason. Rereading one's own tests for judgment finds little: the author sees what they meant to
   write.
2. **A separate session reviews**, one that didn't write the PR and sees only its diff and
   description: `/test-review <PR number>` with the `test-review` skill
   (`.claude/skills/test-review/SKILL.md`) and `/code-review` for bugs in the code. The skill reads
   the PR's description first (the Tests section's layers, what is declared uncovered and why, the
   changed baselines, a fix's "Why tests missed it"), then checks the diff: every change covered or
   explained with an accepted reason, nothing lost when a test is deleted, each assertion on its
   layer, behavior rather than implementation, each test able to fail, fakes true to the services,
   no sleeps or forced clicks, baselines listed, docs matching the code, the threshold not lowered.
   It doesn't run the suite (CI does), and it compares CI's survivors with the PR's `Mutants`
   line, running the mutants itself only when [A test that can fail](#a-test-that-can-fail) says
   so. A reviewer without the skill goes through the same list by
   hand; the skill is the list.
3. **A second round after the fixes**, by the same reviewer: every flagged line again, and every
   test added or changed to fix a finding gets all the checks, since a test written to answer a
   review is a new test. More rounds until the verdict is "ready to merge".

Each round is one comment on the PR headed `Test review, round <n>`, findings first, each tagged
with its check and whether the rule behind it was clear ([below](#improving-the-system)), then the
`/code-review` result on the same commit (its count of findings, or "no findings"), then the
verdict with the commit both reviews saw (`**Verdict: ready to merge** at <short sha>`). Every round
is posted, whichever session runs it: a review that stays in a chat is invisible to whoever merges
and to the retro. A PR merges only on a posted "ready to merge" at its current head; any commit
after that verdict, a merge of `main` included, needs another round, which checks only what the PR's
own diff adds or changes. A real bug that
`/code-review` finds in an open PR's own change is fixed in that PR, red test first, without an
issue: it never reached `main`. The next test-review round records the missed test as a finding
under check A. A bug that reached `main` follows
[When we find a bug](#when-we-find-a-bug).

## Improving the system

The rules in this file, the skill and the PR template are a system that should need less and less
correcting. Every review finding says something about it: either the author slipped on a clear
rule, or the rule was missing, unclear, or said one thing here and another in the skill. A retro
reads those findings in batches and changes the system where a finding repeats, until a batch
changes nothing.

**What each finding carries.** Besides the file, the defect and the fix, the review tags it
`[<check> · <rule>]`: the check is the skill's letter (A–K, the same in every round), the rule is
one of:

- `clear`: the rule says it plainly and the PR didn't follow it.
- `gap`: no rule covers it, or the one here can be read the other way.
- `conflict`: this file and the skill (or the template, or `CLAUDE.md`) say different things.

Each finding is tagged once, in the round that first reports it. A later round that finds it still
open lists it as `still open (round <n>)` with no tag, and the retro counts each PR's findings once.

The review comments are the log: no other file to keep in sync. Escaped bugs keep their own
record, the `test-gap:*` labels ([When we find a bug](#when-we-find-a-bug)).

**When.** Once ten PRs have merged that no row of the table below lists, and at every release
([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before every release), whichever comes first. The
review counts them: when it finds ten or more, its verdict line says "retro due", and the
coordinator of the work (the owner, or the session that hands out PRs) starts it. A
fresh session runs the retro, not one that wrote or reviewed the PRs in the batch. A `conflict`
doesn't wait for it: the reviewer says in the report what disagrees with what, and the next docs PR
settles it.

**How.** Collect the `Test review, round <n>` comments of the merged PRs no row lists yet (the
batch) and the `test-gap:*` issues closed since the last retro, and count the findings by check and by rule:

- Three or more of one check tagged `gap` → rewrite or add the rule, with an example from the
  findings.
- Three or more of one check tagged `clear` → the rule is fine and isn't being followed: move it
  closer to where the author works, preferring, in this order, a lint rule or a CI check, a
  default in a script or config (as the UTC time zone in `vite.config.ts` is), a column or prompt
  in the PR template, a line in the author's checks above. Another sentence in this file is the
  last resort.
- Every `conflict` → one wording, the same in each place.
- A rule that no finding touched in three retros and that nobody can name a case for → consider
  deleting it. The system should get shorter as often as longer.

The changes go into one docs PR, reviewed like any other, which adds a row to the table below and
says which counts each change answers, so the next retro sees whether that count fell. The row and
the PR name the set behind each count (which PRs, which issues, closed since when), and `flaky`
issues are counted apart from escaped bugs.

**Done.** The system is stable when two retros in a row change no rules and the last batch averages
under one blocking finding per PR. From then on the retro runs once per release only, and any new
`gap` or `conflict` starts the ten-PR cadence again.

| Retro | PRs | Ready on the first round | Blocking findings per PR | Escaped bugs | What changed |
| --- | --- | --- | --- | --- | --- |
| 2026-10-30 | #163–#193, 14 with code | 4 of 16 reviewed, 3 of 14 with code; #179 merged without a round, the one breach of the gate | 1.36 (19 in the 14 with code) | 12 closed since the last retro (10 `uncovered`, 2 `environment`), plus 1 `flaky` (#190) | `npm run test:mutants` and one CI run per PR head, survivors accounted for in the PR (A·clear 12, K·clear 4, B·clear 2). The neighbours of a change (10 `uncovered`). A second copy inside a file, fake timers, comments on assertions (F·gap 4). Who owns a test, and the set behind a retro's counts (H·gap 3). A docs prompt in the template, and wrapping is no finding (H·clear 8). The `flaky` class (I·gap 1). A `/code-review` bug is recorded under check A, which the skill now says, so A will rise next retro. Checks D and K in the skill point here. The gate stays as it is, docs-only PRs included |
| 2026-10-29 | #136–#162, 10 with code | 2 of 11 reviewed (10 with code and #136) | 0.9 (9 in the 10 with code), plus 3 in #136 | 10 closed since the last retro (8 `uncovered`, 2 `environment`) | Every round is posted with the commit both reviews saw, and a PR merges only on a posted "ready to merge" at its head. Nothing else: most of the batch and every escaped bug were written before #136, so the next batch judges the new rules |
| 2026-10-28 | #116–#135, 16 with code | 3 of 16 | 1.25 (20) | 0 | Layers 2 and 3 renamed and widened, mock assertions, a test that can fail, wiring places, error paths, routes and fakes, baselines, the Tests table, the review rounds, this section, TZ pinned to UTC |

## Screenshot tests

Unit tests run in jsdom, which has no layout, so they can't catch a button in the wrong place or a title that doesn't clamp. Screenshot tests do: Playwright opens the built app (`vite preview`) in Chromium and compares each screen with a baseline PNG.

- **What's covered:** what only the browser sees, one baseline per layout or state, in the dark theme and Russian unless said otherwise. Specs are in `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`.
  - A phone (390×844): Downloads (list and poster grid, the sort and filter sheet, the actions sheet, selection, empty, offline, the sticky filter bar after a scroll, also with a notched iPhone's safe area, which a DevTools override gives Chromium), Search (browse rows and results), the title page (movie and series, and the page scrolled under the pinned Find releases bar), Releases (results, the filters sheet, the add sheet, also with too little free space, and its file picker), torrent details (with files, a guessed title, changing the title, an error), Settings (and a connection with an error) and the connect screen with a wrong password.
  - A tablet (768×1024): Downloads in the centered column, with the tab bar over it.
  - Desktop (1440×900): the sidebar with labels, Downloads as a grid and as a table (the row and sort menus, selection, offline, the sticky header and column names after a scroll, the header with a notched safe area), Search (incl. no results), the title page (incl. the long overview with Show more), releases under the hero with a filter popover, the torrent drawer over Downloads and over the title page, the add and delete modals, Settings and onboarding. The icon rail (1024×768) in the status menu, releases and Settings; the labelled sidebar at its narrowest (1100×800) and full HD (1920×1080) for the table's columns.
  - The light theme in English twice, where its colors show on every status and on the sidebar: the Downloads list on the phone and the grid on desktop.
  - A behavioral `expect` in a spec only gets a screen to its state, or checks what jsdom can't see (where a click lands, sticky positioning, a container query, a real `<dialog>`); behavior itself is layers 1–4.
- **No live services:** `e2e/app.ts` answers `/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api/settings` and `/api/matches` from the shared fixtures (`src/test/fixtures.ts` through `e2e/fixtures.ts`), matched by URL pathname (a glob like `**/tmdb/**` would also catch Vite's `/src/api/tmdb/` modules). Posters are generated gradients and the release's `.torrent` is built from the fixtures too. The app version in Settings is masked, so a version bump doesn't change the screenshots. The clock is frozen, animations are off and the service worker is blocked. Text is always grayscale (`--disable-lcd-text` in `playwright.config.ts`): left to itself, Chromium now and then draws part of a page's text in grayscale instead of LCD, as it did in two screenshots in CI (#145). What triggers it wasn't found, and a page can't see it, so a test can't wait it out.
- **Docker only:** fonts render differently on macOS and on other Linux setups (about 1% of pixels, enough to fail), so baselines are rendered only in the Playwright image. `npm run test:visual` runs the tests in it with Docker; `node_modules` for the container is kept in a Docker volume, not the host's. Arguments go to `playwright test`, e.g. `npm run test:visual -- e2e/search.spec.ts`.
- **Changing the UI:** a PR that changes how a covered screen looks updates its baselines. First run `npm run test:visual` as is: every failed screenshot leaves an expected, an actual and a diff image in `test-results/`, where the diff highlights only the changed pixels. Make sure nothing but the intended change is highlighted, then re-render with `npm run test:visual:update` and commit the PNGs (GitHub shows image diffs in the PR too). A change too small to fail its screenshot (a hover shade, a pixel of padding) is under the threshold, and the plain update keeps the old PNG: re-render that spec with `npm run test:visual -- --update-snapshots=all e2e/<spec>.spec.ts` and commit only the PNGs of the screens you meant to change. Open every new baseline and check that it shows what its test's name says. The PR lists each PNG with what changed and how it was checked: the diff looked at, re-rendered with `=all`, or new and opened. Add a spec when a new screen, sheet, dialog or state needs one ([Saying why something is uncovered](#saying-why-something-is-uncovered)).
- **In CI:** the `visual` job runs in the same image, on two workers (`playwright.config.ts`; locally Playwright picks). When it fails, its `playwright-report` artifact has the expected, actual and diff images.
- **Upgrading Playwright:** `@playwright/test` in `package.json`, the image tag in `scripts/test-visual.sh`, `scripts/readme-screenshots.sh` and `.github/workflows/ci.yml` must name the same version; re-render the baselines after an upgrade.

### README screenshots

`npm run screenshots:readme` re-renders the screenshots in `docs/screenshots/` (`e2e/readme.shots.ts`, config `playwright.readme.config.ts`): four phone screens and two desktop ones, dark theme, Russian. It runs in the same Playwright image, but on the dev server, so titles and posters come from TMDB for real; qBittorrent and Prowlarr answer from the fixtures. Only `TMDB_API_KEY` goes into the container, from the environment or `.env.local`. Retake them when a screen in the README changes noticeably, check the PNGs and commit them; nothing compares them in CI.

## Smoke journeys

The other half of layer 6: four journeys (`e2e/smoke/*.smoke.ts`, `npm run test:smoke`) drive the
built app in Chromium against the real production server (`server/main.ts` serving `dist/`), with
qBittorrent, Prowlarr and TMDB faked. They cover what no other layer can see: the screenshot tests
mock every server route in the browser and the integration tests run the clients in Node, so
nothing else puts a real browser and the real server together. No pixels are compared, so they
need no Docker: Chromium on the host will do (`npx playwright install chromium`, once).

- **What they check, that nothing else does.** Onboarding on a phone: a wrong password costs the
  server exactly one login attempt, the right one gives the server its own session (the browser
  holds no qBittorrent cookie, and `/qbt/api/v2/auth/*` from the page never reaches qBittorrent),
  the login and the TMDB key land in `settings.json`, TMDB got the key check, a reload rides on
  the server's session without logging in again, and no request the page sent carried a key
  (`page.on('request')`). Search → title → releases → add on desktop, from a deep link the server's
  SPA fallback serves: the `.torrent` travels Prowlarr → server → browser, the browser reads its
  files, and qBittorrent gets the multipart add with the `tmdb:` tag, the category and
  `stopped=true`, then the skipped file's priority, then the start, in that order; Prowlarr's key
  was put back into the download link on the server only; the new torrent shows in Downloads
  with its title. Deleting on desktop, one with its files from the drawer and two at once from
  the list: each `torrents/delete` carries the server's session, the rows go with the next poll
  without a reload, `matches.json` forgets the hashes, and Escape in the native confirmation
  deletes nothing. The service worker: the shell is precached (behind the proxy, so with the
  cookie) and served offline, where the app shows its own "unreachable" screen and comes back on
  Retry; the caches hold posters and never `/qbt/`, `/prowlarr/`, `/tmdb/` or `/api/`. Every
  journey also asserts the proxy refused nothing, so every fetch carried its cookie.
- **What they don't.** Looks (the screenshot tests), and the branches of a flow (an error, an
  empty state, a second qBittorrent version): a journey goes through once; its variations belong
  to the layers above, which run in milliseconds.
- **The stand** (`e2e/smoke/stack.ts`) starts the fakes from `server/test/fakes.ts`, a data
  directory of its own (`mkdtemp`) and the server (`node server/main.ts` with `PORT`,
  `KINOSEED_DIST=dist`, `KINOSEED_DATA_DIR`, the fakes' addresses in `QBITTORRENT_URL`,
  `PROWLARR_URL`, `TMDB_API_URL` and `TMDB_IMAGE_URL`, and no login or key unless asked), and in
  front of it a reverse proxy on the tests' `baseURL` that stands in for Umbrel's app_proxy: a
  page load gets a session cookie, and every other request without it is refused with 401 (marked
  with a header of its own), so a fetch without `credentials: 'same-origin'` fails its journey.
  The journeys run in another process, so the stand has a control server (`e2e/smoke/control.ts`):
  `resetStand()` restarts the server with a fresh data directory and fresh fakes in the state a
  journey wants (configured or not, which torrents, which matches), and `standState()` reads what
  the fakes saw (`seen`, `added`, `deleted`, the login count, the list) and what the server saved
  (`settings.json`, `matches.json`). Playwright starts the stand as the config's `webServer`
  (`playwright.smoke.config.ts`: `npm run build && node e2e/smoke/stack.ts`, the proxy on 4300,
  the server on 4310 and the control server on 4320, one worker, service workers allowed). Locally
  it reuses a stand already running: for a quick loop, build once, start
  `node e2e/smoke/stack.ts` yourself and run `npx playwright test --config playwright.smoke.config.ts`.
- **Adding a journey:** a `*.smoke.ts` in `e2e/smoke/` that starts with `resetStand(…)`, drives
  the UI by role and name in Russian (the context's locale) and ends on `standState()` and on what
  the page sent. Keep it to what a lower layer can't assert. A fake's new behavior goes into
  `server/test/fakes.ts` as an addition, since the server and integration tests run on it; a
  journey that needs the server's matches gives its torrents real-length hashes, which the
  matches route insists on. The journeys share one stand and run one at a time, so they stay few
  and short: the whole run takes about ten seconds.
- **Typechecking:** the journeys and `control.ts` are under `tsconfig.e2e.json` (DOM types, for
  what runs in the page); the stand is a Node program under `tsconfig.smoke.json`, since the
  fakes it imports send `Buffer`s where the DOM's `fetch` types take none.
- **In CI:** the `smoke` job runs on a plain runner, with Chromium cached by the Playwright
  version, in about two minutes; when it fails, its `playwright-report-smoke` artifact has the
  report and the traces (`trace: 'retain-on-failure'`).
