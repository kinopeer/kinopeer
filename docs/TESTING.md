# Testing

How Kinopeer's tests are organized: six layers, each with one job, and how to choose one; what to
do with a bug; what no layer sees; the shared test data and the fake services; coverage and its
threshold; how a PR's tests are reviewed and how review findings change these rules; the
screenshot tests and the smoke journeys. Running and releasing are in
[DEVELOPMENT.md](DEVELOPMENT.md); the checks guard, which marks a PR that weakens the checks, in
[QUALITY.md](QUALITY.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

```sh
npm test                    # layers 1–5 (Vitest), single run
npm test -- --project app   # only the jsdom tests (src/)
npm test -- --project server  # only the server and integration tests (server/)
npm run test:coverage       # the same with coverage and its threshold: a table in the terminal, coverage/index.html
npm run test:mutants        # breaks the lines this branch changes, lists the breaks no test noticed
npm run test:visual         # layer 6: screenshot tests in Docker
npm run test:visual:update  # re-render their baselines
npm run test:smoke          # layer 6: smoke journeys through the production server, no Docker
npm run test:requests       # layer 6: each screen's requests on opening and each move's between screens against their budgets, and a torrent page's layout shift, after npm run build
```

## Layers

| # | Layer | What it checks | What it doesn't | Tool | Where | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pure logic | Parsing release and torrent names, picking a title, filtering and sorting, formatting, the SHA-1 fallback, the checks guard's signs, its reading of a test file and its comparison of the tests that ran, the size budget's rules, the requests budget's rules: functions that import no React, DOM or Node APIs | Rendering, the network | Vitest | `*.test.ts` next to the module (`src/releases/`, `src/torrents/`, `src/lib/`, `server/json.ts`, `scripts/guard/` but for `guard.ts`, `scripts/size/budget.ts`, `scripts/requests/budget.ts`) | `npm test` |
| 2 | Components and generic hooks | A shared component renders its props with the right roles and names and reacts to input; a hook that knows nothing of the app's data does its job in a DOM (`useIsDesktop`, `useHeightVar`, `useScrollRestoration`, the theme) | Layout and looks, which jsdom has none of; the app's data | Vitest + Testing Library, jsdom | `src/components/*/*.test.tsx`, the hooks in `src/lib/`, `src/theme/` | `npm test` |
| 3 | Screens, stores and clients | A screen or a user flow with the API clients mocked (`vi.mock('../api/…')`): what it shows for a state, what it sends, where it navigates. A hook or a store that holds the app's data, with the clients mocked. An API client with `fetch` stubbed: the request it builds and how it reads each answer, errors included | Real HTTP, the server, layout | Vitest + Testing Library + user-event, jsdom | `src/screens/*.test.tsx` (sheets and dialogs included), `src/App.test.tsx`, the hooks and stores in `src/session/`, `src/torrents/`, `src/settings/`, the clients in `src/api/*/` | `npm test` |
| 4 | Server | Each middleware under `server/` against fake qBittorrent, TMDB and Prowlarr servers started in the test: routing, headers, what reaches the service and what comes back | Browser code | Vitest, Node (`server` project) | `server/*.test.ts`, fakes in `server/test/fakes.ts`; the TMDB proxy worker in `tmdb-proxy/worker.test.ts`, with TMDB and the rate limiter faked in the test, and its deploy check in `tmdb-proxy/deployCheck.test.ts` over a git repository made in the test; the dev and preview servers started from the config in `vite.config.test.ts`; the checks guard in `scripts/guard/guard.test.ts`, over a git repository made in the test; the size check in `scripts/size/size.test.ts`, over a build folder made in the test | `npm test -- --project server` |
| 5 | Integration | The real clients in `src/api/*` calling the real `kinopeerServer()` in front of the fakes: both ends of each route agree on paths, bodies, cookies and errors, and the flows that cross several routes (login, adding a release, matches) | Rendering; a server without a route (the SPA fallback), which stays in the client tests | Vitest, Node | `server/integration/*.test.ts`, the stand in `server/test/integration.ts` | `npm test -- --project server` |
| 6 | Browser | How the screens look: the built app in Chromium against baseline PNGs, with every server route mocked (screenshot tests). And six smoke journeys through the real production server behind a proxy that wants a cookie, with the services faked: the browser and the server together (smoke journeys). And what each screen asks the servers for when it opens, and each move between screens in short journeys, counted against its budget, with the routes mocked as for the screenshots (the requests tests). And how far a torrent's page moves as it loads, its answers let land in each order (the layout shift test) | Behavior, which the layers above cover faster | Playwright in Docker; Playwright on the host | `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`; `e2e/smoke/*.smoke.ts`, the stand in `e2e/smoke/stack.ts`; `e2e/performance/requests.perf.ts`, `e2e/performance/journeys.perf.ts`, `e2e/performance/layoutShift.perf.ts` | `npm run test:visual`; `npm run test:smoke`; `npm run test:requests` |

Layers 1–5 run on every `npm test` in two Vitest projects (`vite.config.ts`): `app` is jsdom with
`src/test-setup.ts` (jest-dom matchers, the interface language reset to English, Testing Library's
cleanup, a no-op `window.scrollTo` since jsdom only logs "not implemented" for it); `server` is
plain Node for `server/**/*.test.ts`, the integration tests included, `tmdb-proxy/**/*.test.ts`,
`scripts/guard/**/*.test.ts`, `scripts/size/**/*.test.ts`, `scripts/requests/**/*.test.ts` and `vite.config.test.ts`. Tests sit next to the code as
`*.test.ts(x)` and query by role and accessible name. Two kinds of test don't follow the table's
"Where" column. The service worker: its routing rules are plain logic in `src/pwa/swRoutes.ts`
(layer 1), and `src/sw.test.ts` is a smoke test of `src/sw.ts` with workbox mocked, compiled with
the worker's `tsconfig.sw.json` rather than the app's. And a check that reads a source file as
text (the tokens and raw px values in the stylesheets, `src/styles/tokens.test.ts`; the poll ring's
keyframes, in `PollRing.test.tsx`) is layer 1 wherever it sits, although it reads the file through
`node:fs`: it asserts what the file says, and how that looks is layer 6's (#241).

`npm test` is to stay under 20 seconds on the owner's Mac (10 cores), checked before every release
([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)). Most of that time isn't the tests: Vitest starts
every file in a fresh worker, and each `app` file imports jsdom, React, Testing Library and i18n
again, about half of the run at 0.7.0 (17.8 s for 147 files, the test bodies about 50 s of worker
time over the ten cores). So the time grows with the number of files more than with slow tests. The
limit was 15 seconds until 0.7.0, when it was raised rather than the run made faster (2026-11-05):
the `vmThreads` pool reuses each worker's imports and ran the suite in 7.7 s, but held 3.2 GB at its
peak instead of 0.4 GB, and gives each file jsdom's window as its global, so an object from a Node
module (`node:crypto`, `Buffer`) comes from another realm and fails an `instanceof` the browser
would pass; `isolate: false` failed 113 tests that rely on modules loaded afresh per file.

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
  The places come from a grep for what the diff changes (the function, the text's key, the
  component, the route), not for its words: #310 grepped the offline texts and missed the failed
  actions' texts that show for the same outage. A place the PR leaves as it is gets a reason checked
  against the code (#323 left out the key checks as having no browser request behind them, while
  `PUT /api/settings/tmdb` and `/prowlarr` wait for them).
- **Later:** what if the sheet was closed, the screen left, or the torrent went away or was replaced
  before the answer came (#172, #174, #184)? Or the page was reloaded: a reload keeps the history
  entry's `key` and `state` (a `TAB_RETURN` included) but nothing the page held in memory (#243).
- **Meanwhile:** what if the user presses it again, reopens the sheet or types while the request is
  in flight (#171, #186)? Typing changes more than the text: a field kept in the URL with
  `setParams(…, { replace: true })` gives the history entry a new `location.key` on every keystroke,
  so whatever is kept per entry is kept again under each (#228).
- **The next poll:** does a poll sent before the change undo it (#192)?
- **The edges:** zero, a negative value, a fraction, the end of the page or the list. A rubber-band
  `scrollY` below 0, a window pinned 1 px from the page's end that a removed row clamps to 0, a
  viewport height that isn't a whole number (#200, #204). The other side of a breakpoint or a
  container query: the narrowest width where a label still shows, not only the widths the baselines
  use (#249). A parameter or a header that widens what an allowlist lets through
  (`append_to_response` on an allowed path, #238). What arrives from outside in a shape the code
  didn't expect: a request from another site without Kinopeer's header (#270), an indexer's URL
  with a scheme other than http(s) (#292), an IPv6 caller where the limiter keyed IPv4 addresses
  (#294). A pattern that reads text from outside (a release's name) is checked for what else it
  catches: the token as an ordinary word of a title (`Vo.Nguyen.Giap` read as a single voice,
  #332), the same letters meaning something else (`MPEG-TS`, a container, and «Звук: TS», only the
  audio, read as a theater rip, #334), another way of writing the same thing (`S01E01-S03E05` lost
  its second season, #333), and every spelling SPEC promises. The names a token must not read go
  in a table of their own in `parseRelease.test.ts`, as "doesn't take %s for a theater rip" does,
  and a new token or spelling adds its rows there.

One behavior, one layer: every statement about what Kinopeer does lives in exactly one test, on the
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
| An installed app signs in again through the proxy once its cookie lapses | A real browser with the service worker, the built app and a proxy that redirects | 6, a smoke journey |

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
- **What a test may count, besides mocks.** A count of how often something happens counts what the
  user or the next layer would see: renders, where "renders only what changed" is the behavior (a
  probe on a child component or `renderHook`'s callback, #244), or writes to storage (#250). It
  never counts what only the implementation has, such as the timers pending (`vi.getTimerCount()`,
  #250). An attribute is read through what it names, not through the DOM's shape: `aria-controls`
  through `document.getElementById`, not `parentElement` (#237).
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
  after a sort or the current title first. Its absence is asserted by name too
  (`queryByRole('option', { name: 'Mixed', hidden: true })` is null, with `hidden` because the
  option carries the `hidden` attribute, so without it the query is null even while the option is
  there), not by counting the others (#229).
- **Helpers and fixtures.** Data every layer shares is in `src/test/fixtures.ts`, the rendering
  helpers in `src/test/render.tsx`, the fake services in `server/test/fakes.ts`
  ([Shared test data](#shared-test-data)). The second copy of a literal or a helper moves it one
  level up: two tests in a file share a `const` or a wrapper at the top of that file, and a second
  file moves it to the shared place, as `DUNE_TORRENT` did. A service's new behavior is an addition
  to its fake, with a comment on what the real service does and in which version; an inline server
  is only for a test that needs the service to misbehave in one specific way. Test data carries no
  behavior the test isn't about: a store test of pruning gives the held request a neutral kind
  (`held`), not `recheck`, which never holds in the app (#224). A step with no effect on the test
  (a pointer move copied from another test, a wait nothing needs) goes, or carries a comment saying
  why it's there (#287's `page.mouse.move(0, 0)`). A case that repeats another's assertions is a
  row in that `it.each`, not a second block (#293). `vi.mock` stays in each test file on purpose,
  so a reader sees what the test replaces without opening another module.
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
  `useMoveTorrent.test.tsx`, `useSpeedLimits.test.tsx`, `useTitleChoice.test.tsx` and
  `useChangeCategory.test.tsx` do, with what a sheet does with what's in flight alone in its own
  tests (`SpeedLimitsSheet.test.tsx`, `ChangeTitleSheet.test.tsx`, `CategorySheet.test.tsx`).
- **A request that expects a state** (pause and resume, recheck, delete). The store's tests own
  which torrents a request sends, when the state is kept and the poll asked again, the order the
  states apply in, and `withExpected` when the poll has the final word (a torrent taken away
  included); `useMainData.test.tsx` shows the state through the two providers.
  `usePauseResume.test.tsx` owns busy across places, the toast and its key, and a watcher taking the
  outcome. Each place that pauses or resumes gets one test that it goes through the shared requests
  (busy from a request sent elsewhere, or left out of a bulk one), and `App.test.tsx` one step that
  `App` links the requests to its poll. A kind of its own (reannounce, recheck, delete, the download
  order's switches) has its hook's test for the same (`useReannounce.test.tsx`, `useRecheck.test.tsx`,
  `useDeleteTorrents.test.tsx`, `useDownloadToggle.test.tsx`, the state it expects included) and a wiring test per place, as
  above. File priorities keep their state against the files poll instead, so
  `useFilePriorities.test.tsx` owns when it gives way to that poll, besides busy per file and where
  a failure goes.
- **A flaky test is fixed or deleted.** Not retried, not skipped, not marked `fixme`: a retry hides
  the instability and a skip hides the behavior (oxlint refuses `.skip` and `.only`). Every Playwright
  config runs with `retries: 0` (the others take it from `playwright.config.ts`), so a screenshot, a
  journey or a count of requests that fails once fails the job.

### A test that can fail

A test counts once it has been seen to fail, and the breaking starts from the diff, not from the
tests: an author who breaks what their tests cover never reaches the branch they wrote no test for.
Before marking a PR ready, the author does both of these and says so in the PR:

1. **`npm run test:mutants`.** Stryker takes the production lines the branch has committed since
   `origin/main`, breaks them one small change at a time (a condition always true, a body emptied)
   and runs the tests that reach each one. A break no test notices survives, and the report lists it
   by file and line. The PR's `Mutants` line gives the count and says what each survivor is: a test
   was added, an accepted reason ([below](#saying-why-something-is-uncovered)), or equivalent (no
   test could tell it from the original, and why). A survivor that only a test's own reset hides
   isn't equivalent: before #224's fix, a module-level `let reading = false` flipped to `true`
   survived because every test called `resetStateLag()` first, and a test on a fresh module (`vi.resetModules()`, then
   `await import(…)`) tells them apart (#224). Stryker can't see code that isn't there, so a missing
   branch is a question for the [neighbours](#choosing-a-layer), and it leaves these alone (the
   mutators `checks.json` leaves out included), so the author breaks them by hand and says so
   in the PR's `Broken by hand` line:
   - a plain value passed on: a prop passed down (`disabled={disabled}`), a provider around a
     screen, a number, a text or its key (Stryker leaves strings alone, so a key swapped for
     another stayed green in #314 and #327);
   - an effect's or a memo's dependency array: drop one dependency (no test noticed `entry` gone from
     #228's keep effect);
   - one operand of a longer condition: Stryker flips the whole condition and not always each of its
     parts, so drop each operand on its own, in an `&&` chain as in an `||`
     (`document.hidden || somethingOpen()` in #225, `change && !unchanged && …` in #247);
   - each alternative in a selector or other string: `'input:focus, textarea:focus'` with one
     alternative removed (#225);
   - which value a guard reads: the store at the moment of sending, not the value the last render
     saw, pinned by two calls before a re-render (#229).
2. **Each new or changed test seen red, once per claim.** Break the code behind each thing its title
   and each comment on its assertions say (remove the guard, flip the condition, return early),
   watch the test fail, put the code back, and say in the Tests table what was broken. A test named
   as a [neighbour](#choosing-a-layer)'s answer claims that case too: break the code for exactly that
   case (a failed lookup asked again after its torrent went away, #250) and see the named test fail.
   One that stays green doesn't answer the neighbour (#237, #244, #248, #250). A claim nothing can
   break leaves the title (#244's "renders again only when its props change").

CI runs the same (`.github/workflows/mutants.yml`) for the latest head of a ready PR: when it's
opened ready or marked ready, on every push to it (a fix, a merge of `main`), or when started by
hand (`gh workflow run mutants.yml --ref <branch>`). A push while a run is going cancels it, so
only the latest head is mutated, and the run adds the survivors to that commit as its `Mutants
report` check (neutral while something survived), not as a comment on the PR, which emailed its
author on every push. They don't fail the job, since an equivalent mutant would fail it for good; a
survivor the PR doesn't account for, in the `Mutants` line or in the author's `Fixes for round <n>`
comment for a later head, is a review finding. A round reads CI's report at the commit it reviews
(`gh api 'repos/{owner}/{repo}/commits/<sha>/check-runs?check_name=Mutants%20report' --jq
'.check_runs | max_by(.completed_at) | .output.summary // "no report yet"'`), and waits for it
while the run is going. The reviewer runs `npm run test:mutants` locally only when no report can
come for that commit (Actions out of minutes, the job failed), and says so in the round. A branch
with no production line changed gets Stryker's dry run instead (`--dryRunOnly`: the tests once,
through Stryker's sandbox and instrumenter, nothing mutated), and the workflow also starts on what
Stryker runs with (`package.json`, the lockfile, `stryker.config.mjs`, `checks.json`, `vite.config.ts`, the
script and the workflow), so a dependency bump that breaks Stryker fails there rather than on the next PR with
code (#285, TypeScript 7).

A test that stays green with the behavior it names removed is a `silent-test` miss in the making.
Four shapes cause most of them:

- **An absence asserted too early.** `queryBy…` is null, `not.toHaveBeenCalled()`,
  `toBeEmptyDOMElement()` prove something only after the same test has seen that the answer it waits
  for arrived (a text the answer renders, the mock's promise resolved); before that they pass on a
  screen that hasn't loaded.
- **Two causes, one test.** A test about one cause keeps the others out: a swipe test about the
  distance uses a slow swipe, so the flick rule can't pass it for the wrong reason.
- **Outcomes that look alike.** Each candidate gets a value of its own, so the test tells which one
  it got: with the user's key and Kinopeer's both `good-key`, the call that reached TMDB couldn't
  say whose it was (#248). A count of renders can't see two updates that `act` batches into one;
  count what each would do, a write to storage (#250).
- **The clock.** Vitest runs in UTC (`env` in `vite.config.ts`), the same on any machine and in
  CI; a test that reads the time pins it with `vi.setSystemTime`, and one about another time zone
  sets it with `vi.stubEnv('TZ', …)`, which Vitest puts back before the next test (`unstubEnvs` in
  `vite.config.ts`). A `process.env.TZ` assigned by hand stays for the rest of the file. A real
  timer is a sleep even at no delay: a flush through `setTimeout(resolve)` waits on the event loop,
  not on the answer. Await the promise the code returns, or use fake timers and `await
  vi.runAllTimersAsync()` (#224).

**What a test puts in place outside its own tree.** Vitest puts back every `vi.spyOn` spy,
`vi.stubGlobal` and `vi.stubEnv` before each test (`restoreMocks`, `unstubGlobals` and `unstubEnvs`
in `vite.config.ts`), so each is made in the test or its `beforeEach`, never in `beforeAll` or at
the top of the file: there it's gone by the first test, which then runs without it and stays green
(`browseRows.test.ts` stubbed its time zone in `beforeAll`, and its date tests ran in UTC until
#253 moved the stub). The one exception is a stub only the file's load needs: `sw.test.ts` stubs
`self` before it imports the worker, and its tests read what that load captured. A listener on
`document` or `window` and fake timers are the test's to remove: in `afterEach` or through
`onTestFinished`, not at the end of the `it`, where an assertion that fails first leaves them to
every later test in the file (#243). A test doesn't clean up what Vitest puts back: oxlint stops
`vi.restoreAllMocks()`, `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()` ([Lint rules for
tests](#lint-rules-for-tests)), and a new test doesn't write a spy's `mockRestore()` for it either,
while the ones already in the tree do nothing now and go when their file is next changed. A test
that needs another answer than the stub its file's `beforeEach` made stubs it again, through the
helper's other answer (`stubDesktop(false)` for the phone layout), rather than undoing it.

The Seen red column is the author's word, and the review can only read the tests for these shapes;
the survivors in CI's report are not.

### Saying why something is uncovered

A change without a test says so in the PR's Tests section, with the reason, and the reason is one
of these:

- **Looks and layout:** CSS, spacing, a token in a screen that already exists; checked on the test
  stand, by a screenshot baseline, or measured in Playwright in the CI image, and the PR says which
  and what was looked at (for a measurement, the numbers: #227 gave the card's widths against the
  chip's). A new screen,
  sheet or dialog gets a baseline instead, and so does a new state whose layout differs from the
  ones covered (an empty or error state with its own arrangement, not only other text).
- **A blind spot:** only a real phone, Umbrel's proxy, a real service version or real time shows
  it ([Known blind spots](#known-blind-spots)); the PR names the spot and every environment the code
  runs in that no layer sees (a rule under `pointer: coarse` runs on Chrome on Android and on tablets
  too, not only in Safari: #200), and, when the checklist has a manual check for it, that it was
  done. A blind spot is an environment no layer can start; what a Node test starts isn't one:
  Vite's dev server and preview answer a request in about 50 ms from `createServer` and `preview`
  (`vite.config.test.ts`, #271).
- **Covered already:** a refactor or a move that an existing test still asserts; the PR names that
  test by its `it` title, and the reviewer opens it. It holds only when that test executes this
  very path. Each place that wires a shared component (a second screen that opens the same sheet,
  the phone and the desktop variant of one action) gets a step of its own that proves the wiring:
  the control is there and does the thing, its own and not a sibling's: the step tells its
  handler from one that would do the same at that step (one press on the releases' sort chip
  turns the order whether it calls `cycleSort` or `reverseSort`, so #336's test presses twice).
  "Same code as in X" isn't a reason.
- **The platform's own behavior:** what the browser or Node does with what our code hands it, as a
  real `fetch` cancelled by its `AbortSignal` (#206). The PR names the test of the hand-off (that
  the signal reaches `fetch`). GitHub Actions counts too, for what it does with what a workflow
  hands it: the concurrency group two runs compute (#289), how an `&&`/`||` expression picks
  between its sides, the documented ternary idiom, once each input that chooses a side was run
  (#298), a secret passed by name to a reusable workflow (#291). The PR names the hand-off it
  checked (the group key both runs compute, the inputs of each side) and the documentation page it
  read the rest from.
- **A known limitation the owner chose to keep:** a case the PR leaves as it is by the owner's
  decision. The PR links the decision (the row in `docs/SPEC.md`'s decision log, or the comment with
  the owner's decision) and says what happens in that case: a forget that fails after its sheet closed
  goes unsaid, as saving a key does (#248).
- **No behavior:** docs, comments, CI and config, types, generated files, a re-export. A branch in a
  script or a workflow (whether to install, whether to deploy, which targets a matrix reaches) is
  behavior: it moves into a module with a test, as the proxy's deploy check did
  (`tmdb-proxy/deployCheck.ts`, #238), or the PR says what was run by hand and with which inputs
  (#232). A run that stops before it changes anything counts: a dry run, a read-only command, or one
  with a bogus credential that the service refuses only after the tool has resolved its target
  (#258's `wrangler secret put` with a bogus token named the worker each matrix entry reaches), so
  a missing credential isn't a reason on its own. A run that can only come later (at the next
  tag, on a day with steps of its own) is named in the PR as the check of that change, with what
  stays in place until it's green: the old token and the old deploy key stay until the first run
  through the `deploy` environment passed, since "can't run here" holds for the PR and not for the
  day it hands the run to (#291). "CI and config" is what decides nothing.

A behavior removed on purpose isn't uncovered: the PR's What and SPEC's decision log name it, and
the review finds it there rather than in a test that still asserts it (#231's rail tooltip).

"Trivial", "later", "tested manually" without saying what and where, or a reason that doesn't fit
the diff are not reasons: the change gets its test or the PR explains itself better. The review
(`/test-review`, [Reviewing a PR's tests](#reviewing-a-prs-tests)) reads this section first and
checks the reasons before it looks for missing tests.

## When we find a bug

A bug is two defects: one in the code and one in the tests that let it through. A `fix:` PR answers
three questions: why it broke, why the tests didn't catch it, and what changes so this class of miss
is caught from now on. The order of work:

1. **An issue of the Bug type first.** A bug that reached `main`, from the test stand, from Umbrel or from a test under construction
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

| Class | What it looks like in Kinopeer | What we do besides the test |
| --- | --- | --- |
| `uncovered` | Nobody sent `cancel` to a confirmation nested in the drawer (#107) | Add the test. A whole module or family of states without tests gets covered, not just the one case |
| `wrong-layer` | A jsdom test asserted that the filter bar "stays at the top", which jsdom can't see | Move the statement to the layer that sees it (a screenshot after a scroll) and delete the old test |
| `implementation` | A screen test's mock answered what the server never sends, so the screen passed against a fiction | Rewrite the test to the behavior the user sees; the contract between client and server goes to layer 5 |
| `fake-drift` | qBittorrent 5.3 answers 401 to a wrong password; the fake still answered `200 "Fails."` | Fix the fake, with a comment on the real behavior and the version it was seen in, and run everything on the fixed fake |
| `environment` | No `crypto.subtle` over plain HTTP; Umbrel's app_proxy wants a cookie on every fetch; the service worker served the old shell | Add the environment to layer 5 or 6 when a browser in CI can run it (the smoke stand's proxy is one); otherwise a line in [Known blind spots](#known-blind-spots) and a manual check in `RELEASE_CHECKLIST.md` |
| `silent-test` | A test that passes with the behavior it names removed: no `expect`, a `.skip`, an absence checked before the answer arrived | Fix or delete the test; where oxlint can catch the shape, a rule in `.oxlintrc.json` |
| `flaky` | Not a bug that reached anyone, but a test that fails now and then: a toast found inside a modal that was closing (#190), a screenshot off by a few pixels on one run in CI (#145) | Fix or delete the test; where a helper can take the shape away, add it, as `findToastOnPage` did. The retro counts these apart from escaped bugs |

The record: a **Why tests missed it** section in the PR (the template has it) with the class and
what changes so the class is caught, and the `test-gap:<class>` label on the issue. A PR that fixes
a flaky test carries the same record, whatever its title's prefix; one flake can't be shown red on
demand, so it says how often the test failed and how many runs it now passes. A systemic
finding (a blind spot, a fake that had drifted) also becomes a line in this file, in the same PR. A
manual check the fix adds says what has to be in place for it to pass: the reload on resume (#210)
can pass only on a page that already has the update check, so not on the first update after the fix
(#225).
There is no separate log: the closed issues with these labels are the history.

Each retro looks at the pile ([Improving the system](#improving-the-system); before 2026-11-10 each
release did, and a retro counting the same issues made that a second count, #346): three issues of
the Bug type with one class since the last retro are a problem of the system, not three accidents,
and so are three of the Task type with one class.
Three `fake-drift` → compare the fakes with the live services on Umbrel by hand; three
`wrong-layer` → the layer rule above reads badly, rewrite it; three `uncovered` in one area → that
area gets a pass over its states, not three more tests; three `environment` from one environment →
it goes into layer 5 or 6 when a browser in CI can run it, and when none can (the app added to the
Home Screen on iOS) its manual check moves from the release into every PR that touches it, as the
phone check on `preview-lan` did; three `implementation` → review the mocks in that area; three `silent-test` → a lint
rule; three `flaky` → a helper or a lint rule that takes their shape away, as `findToastOnPage`
did. The retro runs the same count over review findings.

Rules next to this one:

- A bug seen on the test stand or on Umbrel is an issue with the steps and the environment first,
  then a `fix:` PR; not a fix from memory.
- A test that fails during a planned change is not a bug. The test changes only when the new
  behavior is written down in `SPEC.md` or `CHANGELOG.md`; an assertion is never loosened to make it
  pass.
- A bug is Kinopeer (the app, the server, the image, the TMDB proxy) behaving otherwise than
  `SPEC.md` describes or, where `SPEC.md` says nothing, than expected, where someone using it can
  meet it. A problem of the
  tests, CI or the development tools that no user meets (a flaky test, a stack trace in CI's
  output, a broken `test:mutants`) is an issue of the Task type; it gets a `test-gap:*` label all
  the same when the tests missed it.
- Behavior that works as intended (as `SPEC.md` describes it) but turned out a poor choice is not a
  bug either: it's an issue of the Feature type, worked on in a `feat:` PR, with no `test-gap`
  label and no "Why tests missed it" section in the PR. The issue's Type field says which case it
  is, not the wording of its text. The bug form gives every report the Bug type, so whether it is
  one is the call of whoever files the issue, and whoever works on it may still change the type by
  the item above (whether a user can meet it, then what `SPEC.md` says); without a type, it
  decides.
  #316 (the release filters hid releases whose name the parser couldn't read) was a Feature.

In practice: #107 (Escape in the delete confirmation closed the drawer too) was found by the delete
smoke journey while it was written, filed with the desktop layout and Chromium as its environment
and labelled `test-gap:uncovered`, and fixed in #108 with a red jsdom test in
`DownloadsWithDrawer.test.tsx` first, then the guard in `TorrentDrawer`, `Sheet` and `Dialog`; the
journey now presses the real Escape it had skipped.

## Known blind spots

What no layer sees. Each is either checked by hand before a release ([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
→ Before every release) or knowingly not checked; a bug from one of them is an `environment` miss,
and its fix either adds the environment to a layer or adds a line here. Any PR that meets a blind
spot this table doesn't name adds its row, a feature as much as a fix (#240's desktop Safari,
#247's flip of sequential download); a blind spot is an environment no layer can start, not a
server a Node test can (Vite's dev server, #271).

| Blind spot | What the tests run instead | How it's covered |
| --- | --- | --- |
| A real phone: Safari on iOS, installing the PWA from Share → Add to Home Screen, the standalone window, the on-screen keyboard over a sheet | Chromium at 390×844 in Docker, where a mouse drag and a wheel over the backdrop stand in for a finger (with touch emulation on, so `pointer: coarse` matches) (a sheet dragged closed, the page behind it staying put), and the keyboard's variables set by hand (Chromium opens no keyboard), with `trackKeyboardInset` on layer 2 against a stubbed `visualViewport`, and `holdPage` on layer 2 (a swipe's `touchmove` prevented or not, the field's transform for the frame it gets focus in, or `NAVIGATION_HOLD_MS` after the keyboard's arrows, the body's negative margin from the start of a hold on a modal with a text field), since no layer sees Safari scroll the page to a field (#168) or the layout viewport part from the visual one (#175), or what reaches the screen when the page is pinned (#203, which showed in the installed app and never in the iOS Simulator) | By hand on the owner's phone against `preview-lan`, a production build, for a PR that changes a phone screen (`dev-lan` has no manifest, so what it adds to the Home Screen isn't the installed app, where #197 and #203 showed), or in the iOS Simulator's Safari (Xcode), which opens the on-screen keyboard and scrolls the page as a phone does, and the checklist's phone pass before a release. A Safari tab has no top safe area (`env(safe-area-inset-top)` is 0 there), so what sits under the status bar shows only in the app added to the Home Screen. Chrome on Android, which also opens the keyboard over the page, isn't checked |
| Desktop Safari (WebKit): its own properties (`-webkit-backdrop-filter`, #240) and where its rendering parts from Chromium's | The screenshot tests in Chromium only. The Playwright image has WebKit too, which a review can use for a one-off measurement (#249 measured where the status menu's popover lands) | By hand by the owner on the test stand in Safari on the Mac, for a PR that uses a WebKit-specific property; otherwise not checked |
| Umbrel's real app_proxy and HTTPS with Umbrel's certificate: its sign-in page and the form that hands the cookie back, the cookie's lifetime (a week from the last page load through the sign-in, #303), the sign-in opened over the app installed on an iPhone's Home Screen, its 502 for an app that's stopped (which the client takes for Kinopeer's server not answering, having no `x-kinopeer-bridge` header), the service worker under a certificate the phone had to trust, and that certificate renewed every month under a browser's per-site exception, which fails every request until the user accepts it again (#311) | The smoke stand's proxy, which redirects a request without the cookie to a sign-in on another origin and gives the cookie to any page load, over plain HTTP | The checklist: after the Umbrel package updates, onboarding, a search and an add on the owner's Umbrel; before every release, the cookie deleted under the app on the owner's phone and the app signing in again through Umbrel back to its screen |
| The Home Screen icon on iOS: Add to Home Screen fetches a linked touch icon in a process of its own, which the page's Web Inspector doesn't show and which got nothing over Umbrel's HTTPS (#304) | `vite.config.test.ts` on layer 4: the dev server's `index.html` carries the icon as a `data:` URL of the PNG in `public/`, so there is nothing to fetch | The checklist: Add to Home Screen on the owner's phone over HTTPS previews Kinopeer's icon |
| qBittorrent's refresh: after a pause or resume, `sync/maindata` reports the old state until qBittorrent next updates the torrents' states, once per refresh interval (1.5 s by default; `TorrentImpl::stop` and `start` in 5.1), while a recheck shows at once (#209). Flipping sequential download off showed the same lag on 5.3.0 (1.15 s, checked live in #213), off but not on, so both switches hold for it | No clock in the fake, which leaves the state as it is after `/torrents/start` and `/stop` and flips `seq_dl` and `f_l_piece_prio` at once. A test that mocks the polls after an action answers them the way qBittorrent does: what an action changes in a poll is read in qBittorrent's source first, not assumed | `useMainData.test.tsx` and `torrentRequests.test.ts` on the hold a request keeps over those polls, `useDownloadToggle.test.tsx` on the switches holding and staying off for it; the real lag only on the test stand against the owner's qBittorrent |
| The real qBittorrent and Prowlarr: a version that changes an answer | The fakes in `server/test/fakes.ts`, written from qBittorrent 5.3 (401 on a wrong password; `legacy` for the older `200 "Fails."` and 4.x's `/torrents/pause` and `/resume`) and Prowlarr 1.24, with the version in a comment where it matters | Not until someone hits it: then it's a `fake-drift` miss and the fake moves with the service. Three in a release → compare every fake with the live services by hand |
| Plain HTTP without `crypto.subtle`: reading a `.torrent` with the SHA-1 fallback in a real browser | `src/lib/digest.ts` on layer 1 against known digests; every browser test runs on localhost, a secure context, where Web Crypto exists | The checklist: add a release over `http://` on the LAN, where the info hash must still match qBittorrent's |
| TMDB for real: field shapes, missing posters, the language fallback, rate limits | The fake and the fixtures' titles | Only the README screenshots (`npm run screenshots:readme`, through the edge worker's cache unless a key is set) and the test stand see the real API; nothing compares them, so a change in TMDB's answers arrives as a bug report |
| An app resumed from memory after an update: Safari on iOS keeping the Home Screen app's page, the new service worker taking it over, Umbrel's proxy in front of `version.json` | `src/pwa/updates.test.ts` on layer 2 with `fetch`, `visibilitychange` and the service worker's registration stubbed (#210); every browser test loads a fresh page, which already has the new version | The checklist: after Umbrel updates Kinopeer Edge, resume the app on the owner's phone from the background and see it reload with the "updated" toast. Only a page that already has the update check can pass: the first update from a build before it can't |
| The Content-Security-Policy outside Chromium and behind Umbrel's app_proxy: WebKit's enforcement (Safari on iOS and the Mac), and whatever the proxy adds to or changes in the pages | The smoke journeys, which fail on anything the policy blocks in Chromium on the production server (`e2e/smoke/test.ts`), and the screenshot tests, which run under it on `vite preview` | The checklist: no "Content Security Policy" error in Safari's console on Kinopeer Edge while going through the phone's and the desktop's checks (but for Safari's own "Refused to apply a stylesheet", one per `<select>` on the page, SPEC's decision log), and the app still opening from Umbrel (`frame-ancestors 'none'` would stop it in a frame); for a PR that changes the policy, the same on the `preview-lan` stand |
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
  change to a name, size, date, order or `NOW` re-renders them. Its data names no real tracker,
  release page or release group (`CLAUDE.md` → Conventions): indexers are `Indexer A` to `Indexer D`,
  pages and announce URLs are on `example.org`, `example.com` or `.test`, and release names keep
  a real naming style with made-up groups (`-GRPA`) and no voice-over studios. The studios
  `parseRelease` recognizes are product logic, so they stay in it and in its own test.
- **`src/test/render.tsx`:** `renderWithRouter(ui, entries)` renders under a `MemoryRouter` at the
  last of `entries`, for screens that read the URL or navigate; `<Where />` rendered next to them
  shows the current path, which `where()` reads back. `saying(text)` matches a live region by its
  text, as the `name` for `findByRole('status')` or `'alert'`. `fakePoll()` is a `PollSource` whose
  state the test sets (`set`), for what shows the poll or needs one to pass on. API mocks stay in each test file
  (`vi.mock`, hoisted), so a reader sees what the test replaces without opening another module.
  A mock of calls that run several at a time with an `AbortSignal` (the title lookups) holds its
  answers until the test lets each one through and rejects once its signal aborts, as `fetch` does,
  and the test sends more of them than run at once: a mock that answers at once never has a call in
  flight when another one lands, so it can't show one call stopping or repeating the others (#239,
  `holdSearches` in `titleMatches.test.ts`).
- **`server/test/fakes.ts`:** `listen(handler)` starts a handler on a free port and returns its
  origin, `serve(middleware)` does the same for the middleware under test with Vite's 404 fallback,
  `closeServers()` closes everything in `afterEach`, the connections a test left open included,
  `bodyOf(request)` reads a body. `silentService()` is a service that never answers, with
  `received` (a request reached it) and `closed` (Kinopeer gave that request up);
  `abandon(url, received, init)` sends a request and aborts it once `received` resolves, as a
  browser that leaves does; `settlesWithin(promise, ms)` says whether a promise settled in time.
  `fakeQbittorrent()` is a qBittorrent with one user that hands out SID cookies, can expire them
  and records the requests past the login; behind the login it serves the fixtures' torrents
  (`/torrents/info`, `/sync/maindata` with a delta after the first `rid`), the trackers, and adding
  (`/torrents/add` is parsed into `added`, `/torrents/files` answers the `files` a test set for a
  hash, `/torrents/filePrio` changes them, `/torrents/start` and `/stop` answer OK and leave the
  state as it is, as qBittorrent does until its next refresh; with `legacy`, qBittorrent 4.x,
  they answer 404 and `/torrents/pause` and `/resume` answer OK instead). `fakeTmdb()`
  answers the API (a title's details from the fixtures, TMDB's 404 for one it doesn't have, 401 for
  the key `bad-key`), the authentication check (`good-key` passes) and the image host, recording
  what reached it. `fakeProwlarr()` wants its key in `X-Api-Key` (401 otherwise) and answers the
  status check, the indexers' status (`indexerStatus`, none failed by default), a search with the fixtures' releases (their download links carry the key, as
  Prowlarr's do) and a download: the Shōgun `.torrent` for the link `shogun`, a redirect to a magnet
  link for `magnet`, 404 for anything else. A service that never answers is `silentService()`; a test that needs
  one to misbehave in another specific way (an answer that isn't a `.torrent`, a body that comes
  in parts) writes that handler inline with `listen`.
- **`server/test/integration.ts`:** the stand for layer 5, below.

## Integration tests

Layer 5 checks the contract between a client in `src/api/*` and the route in `server/` that serves
it, which no other layer sees whole: the screens mock the clients, the client tests mock `fetch`,
the server tests send requests by hand. `startKinopeer()` (`server/test/integration.ts`) starts the
three fakes, a data directory of its own (`mkdtemp`) and the real `kinopeerServer()` with an
environment pointing at them (`QBITTORRENT_URL`, `PROWLARR_URL`, `TMDB_API_URL`, …, logged in to
qBittorrent as admin), chained the way `server/main.ts` chains the routes; `stopKinopeer()` in
`afterEach` closes everything, restores `fetch` and removes the directory. A test passes `env` to
change the environment (a variable set to `undefined` is unset: no login, no Prowlarr, a dead
port), `writableData: false` to make every write fail, `tmdbProxy` to put the real TMDB proxy
worker (`tmdb-proxy/worker.ts`, `serveTmdbProxy` in `server/test/fakes.ts`) in front of the fake
TMDB at `TMDB_PROXY_URL`, which is empty otherwise, so no test reaches the deployed one (with
`overLimit` its rate limiter refuses every call, as for an IP over its limit), and the fakes'
options.

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
file, plus an HTML report in `coverage/` (git-ignored). It measures the TypeScript in `src/`, `server/`,
`tmdb-proxy/`, `scripts/guard/`, `scripts/size/` and `scripts/requests/`, not the config and data files beside it (#283), without the tests themselves, `src/test/`, `server/test/`, type-only modules and the `index.ts` barrels of
`src/api/*` and `src/components/*`, which only re-export (`coverage` in `checks.json`, which `vite.config.ts` reads). CI runs the same in the
`check` job, adds the totals to the job summary (`scripts/coverage-summary.mjs`) and uploads the HTML
report as the `coverage` artifact.

What it measures and its thresholds sit in `checks.json`, as data, where the checks guard compares
them with `main`'s ([QUALITY.md](QUALITY.md) → The checks guard). The run fails under a threshold (`coverage.thresholds` in `checks.json`): 96% of lines and 95% of
functions, two points under the totals of 2026-11-02 (98.01 and 97.09), 93% of branches, two points
under 95.04 on 2026-11-05, and 95% of statements, two points under 97.14 on 2026-11-09, each rounded down. The threshold is a ratchet: when the totals have grown and
stayed there, raise it to two points under them, in the PR that got them there or in one of its own;
never lower it to get a PR through (the guard marks a PR that does, for the owner). A PR that lowers the totals says why in its Tests section (a
module left uncovered on purpose, with the reason). The numbers are there to show what a PR leaves
uncovered; the threshold only keeps that from slipping by unnoticed. It applies to the whole run, so
`npm run test:coverage -- --project server` alone fails it: coverage is measured over both projects.

## Lint rules for tests

oxlint runs its `vitest` plugin on the test files (`.oxlintrc.json`, the one in the root: `npm run lint`
turns nested configs off, [QUALITY.md](QUALITY.md) → What it marks): no two tests with the same
title, no `.skip` or `.only` left behind, every test has an `expect`, no test defined inside a
condition. Its `no-restricted-properties` stops `vi.restoreAllMocks()`, `vi.unstubAllGlobals()`
and `vi.unstubAllEnvs()`, since Vitest's config does what they do before each test ([What a test
puts in place outside its own tree](#a-test-that-can-fail)); the 2026-11-10 retro moved that rule
here after three new calls in one batch (#309, #323, #334).

## Reviewing a PR's tests

Three steps, each by whoever can do it best:

1. **The author checks what doesn't need judgment** before marking the PR ready: `npm run
   test:mutants` with every survivor accounted for and every new or changed test seen red ([A test
   that can fail](#a-test-that-can-fail)), and the Tests section filled in by the template, one row
   per test with its layer, every uncovered part with its reason, each
   [neighbour](#choosing-a-layer) answered, and what Stryker leaves alone broken by hand. The docs
   too, every file that describes what the diff changes: `CLAUDE.md` and the files in its docs
   table (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, SPEC, ARCHITECTURE, DEVELOPMENT,
   this file, QUALITY, the release checklist, the changelog), the review skills in `.claude/skills/`, and the
   PR template, the workflows and the config, whose comments are docs too, with `.env.example`; 30
   of the 2026-11-08 batch's findings sat in files the old rule didn't name (#287's README
   promising "multilingual" for two languages, #296's changelog entry describing no change, #300's
   runbook). The whole tree grepped for each number or name the diff changes (a width, a version, a
   count: #227 left SPEC at 380px), by its old value and each word of an old name on its own
   (`git grep -n -I '380px' -- ':!package-lock.json'`; #261 grepped `kinoseed-tmdb` and left
   "Kinoseed's included"; #258 changed README's port 8795 and left ROADMAP's), since a list of
   folders falls behind, then those files' paragraphs about what the diff changes read through,
   since a claim by meaning has no name to grep (#257's Search paragraph still said "as in
   Downloads, on both layouts"). Each claim is checked against what it describes:
   the code and the tree; the service's own documentation page, opened rather than remembered
   (#299's social preview rule, #300's name of a GitHub option); the words the UI shows (#287's
   alt text named the filters otherwise); the doc it points at (README against SPEC); and a step
   in a checklist, whose pointer resolves and whose check can pass as written (#300 pointed at
   "steps 3 to 6" of a five-step description). The changelog's entry names every change a user sees
   (each text, label and screen the diff changes) and claims no more than the code does (#314 and
   #332 left a change out, #323 and #339 claimed more). Each list the change adds to gets the new item (the
   screens under [Screenshot tests](#screenshot-tests), SPEC's decision log, newest first, the
   blind spots). Rereading one's own tests for judgment finds little: the author sees what they
   meant to write.
2. **A separate session reviews**, one that didn't write the PR and sees only its diff and
   description: `/test-review <PR number>` with the `test-review` skill
   (`.claude/skills/test-review/SKILL.md`) and `/code-review` for bugs in the code. The skill reads
   the PR's description first (the Tests section's layers, what is declared uncovered and why, the
   changed baselines, a fix's "Why tests missed it"), then checks the diff: every change covered or
   explained with an accepted reason, nothing lost when a test is deleted, each assertion on its
   layer, behavior rather than implementation, each test able to fail, fakes true to the services,
   no sleeps or forced clicks, baselines listed, docs matching the code.
   It doesn't run the suite (CI does), and it compares CI's survivors with the PR's `Mutants`
   line, running the mutants itself only when [A test that can fail](#a-test-that-can-fail) says
   so. A reviewer without the skill goes through the same list by
   hand; the skill is the list.
3. **A second round after the fixes**, by the same reviewer: every flagged line again, and every
   test added or changed to fix a finding gets all the checks, since a test written to answer a
   review is a new test. More rounds until the verdict is "ready to merge", which leaves no blocking
   or should-fix finding open, only nits (#325's round 1 said it with a should-fix open). The author answers each
   round with one comment headed `Fixes for round <n>`, at the commit the next round should see:
   each finding fixed (its commit) or declined (why), the tests written for the fixes and what was
   broken to see each red, each survivor in CI's mutants report at that commit that the `Mutants`
   line doesn't account for, a merge of `main` and its conflicts, the docs grepped again for what
   the fixes changed (#230's fix left two sentences stale), and the description's What, Tests and
   Docs brought to that head: whoever merges reads the description first, and the retro counts from
   it (11 findings in the 2026-11-08 batch: #273's What kept the claim its fix removed, #298's Not
   covered described the step before the fix, #291's Docs list named a hunk a merge of `main` had
   dropped). The reviewer starts the next round from that comment and checks the description against
   the head as it checks the docs; a message that points to it is the whole hand-over. A reviewer who sees the PR grow
   past what it set out to do (each round finds bugs in the same new mechanism, workarounds pile up)
   says so in the round, as a finding for the owner to weigh the cost against the gain, not as one
   more fix to ask for (#252). It has no check tag and no severity and doesn't hold the verdict: it
   goes after the findings under its own heading, **For the owner**, and the retro names it in its
   row rather than counting it (#253's round 3 left it open). A screenshot's visible side effect the
   PR doesn't ask the owner about goes there too, as the question itself ([Screenshot tests](#screenshot-tests)),
   and unlike the rest it holds the merge until the owner answers it.

Each round is one comment on the PR headed `Test review, round <n>`, findings first, each tagged
with its check and whether the rule behind it was clear ([below](#improving-the-system)), then the
`/code-review` result on the same commit (its count of findings, or "no findings"), then the
verdict with the commit both reviews saw (`**Verdict: ready to merge** at <short sha>`). Every round
is posted, whichever session runs it: a review that stays in a chat is invisible to whoever merges
and to the retro. A PR merges only on a posted "ready to merge" at its current head. A commit of
the PR's own after that verdict needs another round, which checks only what the PR's own diff adds
or changes; such a commit fixes what the PR already does, and a new request goes into a PR of its
own (`CLAUDE.md` → Conventions). A merge of `main` after it needs a round when either holds:

- the lines `git diff main...HEAD` adds and removes aren't those of the diff the verdict saw, apart
  from conflicts in `CHANGELOG.md`, SPEC's decision log and `CLAUDE.md` resolved by keeping both
  sides (a re-rendered baseline or a field added to a type is a change: #247 after #244);
- or the commits it brings change a file the PR changes, other than those three, even where their
  lines are apart (#243 and #244 in `DownloadsScreen.tsx`; #334's `Merged main` comment named
  `parseRelease.ts`, which #332 and #333 had changed, and it merged without the round).

Otherwise the author posts one comment headed `Merged main at <short sha>`: the PR's diff
unchanged, the conflicts and how they were resolved (`git show --remerge-diff`), the files both
sides change (none outside those three), and CI green at that commit. The verdict carries over to
it, and whoever merges reads both comments. `CHANGELOG.md` merges with `merge=union`
(`.gitattributes`), which keeps both sides' lines, this branch's first, without a conflict once
the branch has `.gitattributes` (a branch cut before it conflicts there on its first merge of
`main`). A line both sides rewrote then stays twice, also without a conflict (#241 rewrote a
bullet #231 had added), so the comment checks `git diff main...HEAD -- CHANGELOG.md` for a line
the PR adds beside `main`'s version of the same entry, keeps one, and says where the PR's entry
ended up.

An outside contributor's PR ([CONTRIBUTING.md](../CONTRIBUTING.md)) gets the same rounds, but the
maintainer's session takes the author's part: it fills in the Tests section, runs the mutants, sees
the tests red and answers each round, with commits to the contributor's branch (they leave "Allow
edits by maintainers" on) or in a PR of our own that takes their commits. The reviewer asks the
contributor for nothing the template's own line leaves to the maintainer.

Dependabot's PRs (`.github/dependabot.yml`: once a month, grouped) skip the rounds and the
template. They change only versions, in `package.json`, the lockfiles, the workflows' `uses:` and the `Dockerfile`'s image digest,
and a round would have nothing of ours to read. One merges on green CI and the owner's OK. Before
asking for it on a major, the session that brings the PR to the owner reads the release notes of
each package it moves a major and says in a PR comment what of them touches Kinopeer, or that
nothing does, since a changed default or a deprecation can pass CI unnoticed. One
that fails, or a major that needs our code changed, is closed, and the update goes into a PR of our
own with the fixes, which gets its rounds. The retro leaves them out of its batch and its count
([Improving the system](#improving-the-system)). A PR's CI doesn't run everything they move:
Wrangler (`tmdb-proxy/`) runs only in `tmdb-proxy.yml`, and the `docker/*` actions other than
`setup-buildx-action` and `build-push-action` only in `edge.yml` and `release.yml`. So after the
`tmdb-proxy` PR, or a `github-actions` PR that changes `edge.yml` or `tmdb-proxy.yml`, merges, the
owner watches the Edge run it starts on `main`; `release.yml`'s actions first run at the next tag
(`RELEASE_CHECKLIST.md` → Before every release). Stryker runs on an npm PR in `mutants.yml`, as a
dry run, since #285: before it a root npm PR didn't start that workflow, and TypeScript 7 (#275)
broke Stryker unseen until the next PR with code.

A real bug that `/code-review` finds in an open PR's own change is fixed in that PR, red test
first, without an issue: it never reached `main`. The round that reports the bug records the
missing test under check A as well, as one finding with the bug, since the test that should have
caught it wasn't there (left to the next round, four such bugs in #230, #231 and #247 were never
counted). A bug that reached `main` follows [When we find a bug](#when-we-find-a-bug).

A PR in which the checks guard marked changes to existing checks gets a second review as well
before it merges, by a fresh session and after the "ready to merge" above: what its record closes
is in [QUALITY.md](QUALITY.md) → What a marked PR needs, and how it is done in the `second-review`
skill.

## Improving the system

The rules in this file, the skill and the PR template are a system that should need less and less
correcting. Every review finding says something about it: either the author slipped on a clear
rule, or the rule was missing, unclear, or said one thing here and another in the skill. A retro
reads those findings in batches and changes the system where a finding repeats, until a batch
changes nothing.

**What each finding carries.** Besides the file, the defect and the fix, the review tags it
`[<check> · <rule>]`, or `[<check> · gap: <reason>]` with what the missing rule would say: the check is the skill's letter (A–K without J, which was retired on 2026-11-03; the same in every round), the rule is
one of:

- `clear`: the rule says it plainly and the PR didn't follow it.
- `gap`: no rule covers it, or the one here can be read the other way.
- `conflict`: this file and the skill (or the template, or `CLAUDE.md`) say different things.

Each finding is tagged once, in the round that first reports it. A later round that finds it still
open lists it as `still open (round <n>)` with no tag, and the retro counts each PR's findings once,
from the reviewer's rounds only: the author's `Fixes for round <n>` comments repeat the tags.

The review comments are the log: no other file to keep in sync. Escaped bugs keep their own
record, the issues of the Bug type with their `test-gap:*` labels
([When we find a bug](#when-we-find-a-bug)).

**When.** Once twenty PRs have merged that no row of the table below lists, Dependabot's left out; a release doesn't call
for one (decided on 2026-11-06: at ten PRs or each release a retro came almost daily, on batches too
small for a finding to repeat three times). The review counts them: when it finds twenty or more,
its verdict line says "retro due", and the
coordinator of the work (the owner, or the session that hands out PRs) starts it. A
fresh session runs the retro, not one that wrote or reviewed the PRs in the batch. A `conflict`
doesn't wait for it: the reviewer says in the report what disagrees with what, and the next docs PR
settles it.

**How.** Collect the `Test review, round <n>` comments of the merged PRs no row lists yet (the
batch) and the issues closed since the last retro, and count the findings by check and by rule.
The issues are split by type: those of the Bug type are escaped bugs, counted by their `test-gap:*`
class against the pile's rule ([When we find a bug](#when-we-find-a-bug)); those of the Task type
with a `test-gap:*` label are problems of the tests and tooling, counted apart against the same
rule. For example,
`gh issue list --state closed --search "type:Bug label:test-gap:uncovered closed:>YYYY-MM-DD"`.
The findings:

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

The second reviews are counted too, from the `**Second review <code>: …**` comments of the batch's
PRs ([QUALITY.md](QUALITY.md) → What a marked PR needs): how many were done, and how many said
`weakening`. When twenty PRs in a row with a second review have no `weakening` verdict, the retro
proposes to the owner to narrow the second review to weakenings. Narrowing softens the system, so
it is the owner's to decide.

Since tags come in both spellings, `[H · gap]` and `[H · gap: <reason>]`, a search that expects `]`
right after the rule misses the second (#299, #302); one that catches both is
`\[[A-K] ?· ?(clear|gap|conflict)(\]|:)`. The search doesn't replace reading: every reviewer round
is read whole, for the `/code-review` findings that carry no tag and the **For the owner** items.

First the owner gets the retro's results as a short summary in the chat, not a document: 3–6
problems, each with its cause explained so that it's clear without knowing the system's rules
(which rule, where it lives: this file, the `test-review` skill, the PR template, and why it didn't
work) and the fix proposed for it. Then how the batch compares with the last retro: the table's
columns (ready on the first round, blocking findings per PR, escaped bugs) and the counts the last
retro's changes answered, so the owner sees whether the system got better or worse. Numbers go in
only where they change a decision or show that trend; the full counts go into the table's row in
the PR. Questions, if any, come with answers to pick from. From the owner's answers the session
writes drafts of the rule changes (`CLAUDE.md` → Workflow), and only then opens the PR with the
table's row.

The changes go into one docs PR, reviewed like any other, which adds a row to the table below and
says which counts each change answers, so the next retro sees whether that count fell. The row and
the PR name the set behind each count (which PRs, which issues, closed since when). The table's
columns: "Ready on the first round" gives the merged PRs and those with production code, the folders `scripts/mutants.mjs` mutates (`src/`,
`server/`, `tmdb-proxy/` and, since #366, `scripts/guard/` and, since #378, `scripts/size/` and `scripts/requests/`; before #238 the first two were all there was); "Blocking findings per PR"
divides the blocking findings (the test review's blocking ones, and the `/code-review` bugs a
verdict says to fix in the PR, each counted once) by the PRs with production code, the same basis
in every row, so the column compares with the rows below it and with the Done rule (#222);
"Escaped bugs" counts the closed issues of the Bug type from the row after 2026-11-10's on (#346),
where it counted every `test-gap:*` issue but `flaky` before, so #283, now a Task, is among that
row's 5 `uncovered`.

**Done.** The system is stable when two retros in a row change no rules and the last batch averages
under one blocking finding per PR. From then on the retro runs every forty merged PRs, and any new
`gap` or `conflict` starts the twenty-PR cadence again.

| Retro | PRs | Ready on the first round | Blocking findings per PR | Escaped bugs | What changed |
| --- | --- | --- | --- | --- | --- |
| 2026-11-10 | #307–#339, 21 merged (#307–#310, #312–#315, #319, #320, #322, #323, #325–#328, #332–#334, #336, #339; #307, the last retro's PR, merged after its row; no Dependabot PR merged in the window; #311, #316–#318, #321, #324, #329–#331, #337 and #338 are issues, #335 answers 404), 12 with production code (#309, #310, #312, #314, #320, #323, #325, #327, #332, #333, #334, #336; #308 and #319 change only `vite.config.ts` and, in #308, its test, which `scripts/mutants.mjs` doesn't mutate). 100 findings in the posted rounds: 65 `clear`, 33 `gap`, 2 `conflict` (both in #307, settled there; #323's round 3 withdrew one of round 2's, left out) | 2 of 21 (#322, and #325, whose round 1 said "ready to merge" with a should-fix open), 1 of 12 with code (#325); a posted "ready to merge" at the head of 20 of 21: #334 merged at a merge of `main` that brought #332 and #333, which change its `parseRelease.ts`, on a `Merged main` comment instead of a round, the batch's one breach of the gate | 2.0 (24 in the 12 with code: #312 5, #334 4 with the spellings `/code-review` raised, #336 4, #310 3, #333 2, #309, #314, #320, #323, #327 and #332 1 each; 1.8 without #336), none outside them. 10 of the 24 are `/code-review` bugs in the PR's own change (#309, #310, #312, #323, #332, #333, #334 4), 6 of them in the release-name parser | 8 closed since 2026-11-08: 5 `uncovered` in four areas (coverage's config, #283; the server's bridges, #305 and #321; Downloads on a phone, #324; the release-name parser, #330) and 3 `environment` from one environment, the app on an iPhone's Home Screen behind Umbrel's app_proxy over HTTPS (#303, #304, #311); `flaky` #337 still open | Another place is found by a grep for what the diff changes (the function, the text's key, the component, the route), not for its words, and a place left as it is gets a reason checked against the code, in Choosing a layer, the template's Neighbours and the skill's A (7 findings, 4 blocking: #310, #312 2, #314, and #323's three A·gap, the key checks, the writes and the connect screen's login). A pattern that reads outside text is checked for what else it catches, with a table of the names a token must not read, in the edges, the template and A (7 A findings in the parser PRs, 5 blocking: #332's three A·gap, `Vo` read as a voice and two title words or spans; #333's A·gap, `S01E01-S03E05`; #334's three A·clear, `MPEG-TS` and «Звук: TS»; plus #334's spellings and #330, `uncovered`, in the same parser). A text's key is among what's broken by hand, since Stryker leaves strings alone (#314's A·clear and #327's K·clear, both blocking; turning `StringLiteral` back on was weighed and declined, since it would bring back the noise the 2026-10-30 retro removed), and a wiring step tells its handler from a sibling's (#336's K·gap), in A test that can fail, the template's Broken by hand and the skill's K (K·clear 7: #312 2, #336 2, #320, #327, #333). A merge of `main` needs a round when either of the two holds, a file both sides change counting even with their lines apart (#334, above), here, in the skill and in `CLAUDE.md`. Once a PR has its "ready to merge" it takes only fixes of what it does, and a new request is a PR of its own, in `CLAUDE.md` and here (#336: 19 findings in 7 rounds, 10 of them, 2 blocking, after its first verdict, from three commits of new requests, two after round 3's verdict and one after round 6's, and their fixes). A PR's kind is its title's prefix, not its branch's, in `CLAUDE.md`, here, the skill's I and the template (#319, #320, #323 and #325 merged from `claude/…` branches, which Claude Code names; #323's For the owner). "Ready to merge" leaves no blocking or should-fix finding open (#325's round 1). The tag's `gap: <reason>` form is part of the format, here and in the skill (#315 left it to this retro). The author's docs check and the template's Docs prompt have the changelog's entry name every change a user sees and claim no more than the code does (H·clear 4 on `CHANGELOG.md`: #314 and #332 left a change out, #323 and #339 claimed more). Not in this PR: an oxlint `no-restricted-properties` rule against new `vi.restoreAllMocks()` and `unstubAll…()` calls (F·clear 3: #309, #323, #334), with the 53 already in the tree removed (21 `restoreAllMocks`, 32 `unstubAllGlobals`; the 38 `vi.resetAllMocks()` stay, since they reset `vi.mock` module mocks, which `restoreMocks` doesn't), goes into a `chore:` PR of its own; the round #334 skipped, over `parseRelease.ts` on `main`, runs in a session of its own. Not moved into every PR, decided by the owner: the check of the installed app behind Umbrel's proxy, though its 3 `environment` meet the pile's rule, since they came from the first pass aimed at that environment, a backlog rather than a trend; the release checklist keeps its whole pass, and one more `environment` from that environment after 0.8.0 brings the rule back. Not changed: H·clear's other 22 (TESTING 7, #307's 4 among them; SPEC 5; the PR's description 5, #336 4 and #339; a checklist, the template, `CLAUDE.md`, an issue and a code comment one each; H·clear rose from 0.89 to 1.24 per PR), H·gap 14 (10 in docs PRs about the rules, #307, #313, #315 and #326, settled in each; #319 and #339's three), F·clear's titles that say more than the body 3 (#312, #325, #336's comment, the fourth batch in a row) and second copies 4 (#312, #313, #323, #327), F·gap 5 (two copies across files, #309 and #320), C·clear 4, D 3, E 2 (#310's Playwright route mock, E·gap, the rule naming `server/test/fakes.ts` alone), G 4 (#336 3; #326's, settled). Checks B and I had no finding; I has had none in six retros and stays, since the record it checks is what the pile counts. For the owner in #312, #320, #323, #328 and #336. The retro was due at #339 (20 before it) and ran after it. Worse on every column, in a batch with twice the PRs with code; this retro changes rules, so Done waits |
| 2026-11-08 | #264–#306, 27 merged (#264–#269, #271–#273, #280, #282, #284, #286–#289, #291, #293, #295–#302, #306; #265, the last retro's PR, merged after its row; Dependabot's #274, #275, #277, #278, #281 and #290 left out; the other numbers are issues), 6 with production code (#271, #293, #295, #296, #297, and #284, whose production lines are comments in two files, 0 mutants). 78 findings in the posted rounds: 33 `clear`, 45 `gap`, 0 `conflict` (#284's round 1 named one untagged, the skill's "ten or more" against this file's twenty, which #266 had settled on `main` the day before; its branch was older) | 9 of 27 (#264, #266, #267, #268, #286, #293, #295, #301, #302), 2 of 6 with code (#293, #295); a posted "ready to merge" at the head of all 27 | 0.67 (4 in the 6 with code: #284 2, #271 1, #296 1; 0.4 without #284), plus 2 in #291 (both A·gap), 1 in #269 (A·clear), 1 in #273 (a `/code-review` bug, `@types/node`'s majors) and 2 in #272 (`/code-review` alone, headed `Review round`, untagged, its reviewer writing that `/test-review` wasn't needed on a docs PR: the one breach of the rounds in the batch, as #179 was of the gate) | 4 closed since 2026-11-06, all `uncovered` (#270, #285, #292, #294), no `flaky` | Check H and the author's docs check cover every doc that describes what the diff changes, `CLAUDE.md` and the files in its docs table, the review skill, the PR template, the comments in workflows and config and `.env.example`, grepped over the whole tree, each claim checked against what it describes (the code, the service's own documentation opened, the UI's words, the doc it points at, a checklist step's pointer and check), in the author's checks, the template's Docs prompt and the skill (H·gap 32 and H·clear 24, 56 of the 78, by where each sat, a finding that cites a named doc among its places counted with the named ones: 30 in files the rule didn't name, README in #287, CONTRIBUTING, SECURITY, the skill and the template in #280, RELEASE_CHECKLIST in #288, #289, #298, #299 and 10 in #300's opening-day runbook, DEVELOPMENT and `.env.example` in #269, CHANGELOG in #296, ROADMAP in #306, workflow comments in #291 and #298; 17 in the named ones, TESTING, ARCHITECTURE, `CLAUDE.md` and SPEC, claims by meaning unread: #273 3, #269 2, #271 2, #297 2, #301 2, #265, #280, #282, #288, #289, #300, four of them citing both kinds, #269, #280, #282 and #288; 9 on the PR's description, next). The `Fixes for round <n>` comment brings the description's What, Tests and Docs to the head, and round 2 and later check it as the docs (9 H findings on the description, #273, #282, #286, #288, #291's banner and its Docs list after a merge of `main` dropped its hunk, #302 2, #306, plus #298's A·gap on its Not covered and #284's untagged test count). The No behavior reason names a run that can only come later, with what stays in place until it's green (#291's two blocking A·gap: the old token and deploy key revoked before the first run through `deploy`); a blind spot is an environment no layer can start, not Vite's dev server a Node test starts in 50 ms (#271, A·gap, here and in the blind spots' heading); the platform's own behavior includes GitHub Actions with what a workflow hands it, the hand-off checked and its documentation page named (#289 2, #298, each accepted that way by its round; #291's secret passed by name). The template's Seen red column says "one break per claim" (F·clear 3 of 4, a title or a comment that says more than the body, #284, #296, #297, the third batch in a row with it; a per-claim break would have left each green). Check F, here under Helpers and fixtures and in the skill, names a step with no effect without a comment (#287) and an assertion block repeated instead of an `it.each` row (#293) (F·gap 3; the third, #297's smoke import, got its oxlint rule there). Layer 4's Where names `vite.config.test.ts` (#271's round 2 left it to this PR). The edges gain what arrives from outside in an unexpected shape (3 `uncovered` in one area, the public-release audit's: a cross-site request, #270; an indexer's URL scheme, #292; an IPv6 caller, #294; the pass over the area was the audit itself, #296, #297 and #305, open; #285 is Stryker on a dependency bump, answered by #286's dry run). The retro counts tags in the reviewer's rounds only, since the author's `Fixes` comments repeat them. Not built: the CI check with an allowlist of records the last row named, since none of the 24 H·clear is a retired name a denylist would catch; H·clear fell from 1.11 to 0.89 per PR. Not changed: B·gap 1 (#284), C·clear 1, E·clear 1, G·gap 1 (#287's README screenshot, not a baseline), K·clear 1, K·gap 2, A·clear 2, the editorial H·gap in #301 (2), #289 and #280, and #273's Dependabot count, settled there. Checks D and I had no finding; I held in the batch's four `fix/` PRs (#271, #286, #293, #295) and stays. For the owner in six PRs (#271, #280, #287, #300, #302, #306), each settled by the owner before the merge. #282's round 2 ran at the merge commit a minute after `Fixes for round 1` at the next one; the retro was due at #299 (21) and ran after #306 (27). The second batch under one blocking finding per PR with code, but this retro changes rules, so Done waits |
| 2026-11-06 | #253 and #255–#263, 9 merged (#253, the last retro's PR, merged after its own row; #254 and #259 aren't PRs), 3 with production code (#257, #258, #260; #261 changes only a comment in `tmdb-proxy/wrangler.jsonc`, which `scripts/mutants.mjs` doesn't mutate). 22 findings: 11 `clear`, 11 `gap`, 0 `conflict` | 3 of 9 (#256, #260, #263), 1 of 3 with code (#260); a posted "ready to merge" at the head of all 9 | 0.67 (2 in the 3 with code: #257 1, #258 1), plus 1 in #253 (K·gap, a `TZ` stub in `beforeAll` that `unstubEnvs` put back) and 2 in #255 (`/code-review`, untagged: the release worker unchecked before the store PR, a dropped roadmap item without a decision record) | 0 closed since 2026-11-04, no `flaky` | A branch in a workflow includes which targets a matrix reaches, and a run that stops before it changes anything (a dry run, a read-only command, a bogus credential refused after the target is resolved) counts as run by hand, so a missing credential isn't a reason on its own, here and in the skill (A·gap 4: 3 in #258, two of them on `tmdb-proxy-key.yml`'s matrix, where round 2 accepted "the token lives only in the secrets" and round 4, an independent review after "ready to merge", resolved all four targets with a bogus token; #253's, `mutants.yml`'s concurrency group shared by forks' branches of one name, goes to [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before the public release, since no fork can open a PR while the repository is private). The docs grep takes the old value and each word of an old name on its own, and the author reads SPEC's and `CLAUDE.md`'s paragraphs about what the diff changes, in the author's checks, the template's Docs prompt and the skill's H (H·clear 10: 4 greps narrower than the old value, #258's `workers.dev` and port 8795, #261's two "Kinoseed" sentences; 2 claims by meaning, #257's Search paragraph and #258's TMDB proxy paragraph in `CLAUDE.md`; 1 a claim about another repository, #262; 1 a fix's own pointer, #258; 2 in #253, a claim true only for a branch that has `.gitattributes` and an aside in `CLAUDE.md` hard to read). Not a CI check yet: one couldn't tell a stale name from a record of the past, which keeps the old one (#258's H·gap); if H·clear doesn't fall by the next retro, a check with an allowlist of those records is the next step. A finding for the owner has no tag and no severity, doesn't hold the verdict and goes under **For the owner**, and the retro names it rather than counting it, here and in the skill (H·gap 5: this one from #253's round 3; #253's other two, `merge=union` keeping a line both sides rewrote and a stub only the file's load needs, were settled in #253; #257's decision restored after a revision and #258's records of the past keeping their names, now in SPEC's 2026-11-05 row, one case each). Coverage measures `tmdb-proxy/` too, which [Coverage](#coverage) didn't say (#264's review). Not changed: #258's third A·gap (literals that must match across files no test reads together, declined there with the reviewer's agreement), B·gap 1, K·clear 1, K·gap 1 (#253's, whose rule, Vitest putting stubs back before each test, that PR added). No finding for the owner in this batch. #258's `Fixes for round 1` came only after round 2 asked for it. Checks E and I had no finding in three retros and stay: E has #209's `fake-drift`, I applies to every `fix/` PR and this batch had none. The first batch under one blocking finding per PR, but this retro changes rules, so Done waits |
| 2026-11-04 | #230–#250, 17 merged (#230–#233, #235–#238, #240, #241, #243, #244, #246–#250; #234, #239, #242, #245 are issues), 15 with production code (all but #232 and #233; #238's is in `tmdb-proxy/`). 71 findings: 40 `clear`, 31 `gap`, 0 `conflict` | 2 of 17 (#240, #241), 2 of 15 with code; a posted "ready to merge" at the head of all 17 | 1.33 (20 in the 15 with code: #250 5, #231 3, #237, #238, #243, #246 and #247 2 each, #230 1, #248 1) | 1 closed since 2026-11-03 (`uncovered`: #239), plus 1 `flaky` (#245) | A test is seen red once per claim, a neighbour's answer included, in the rule and the template (A·clear 12, 5 of them a neighbour answered by a test that doesn't run its case; F·clear 9, 5 of them a title or a comment that says more than the body). Every Neighbours line was filled, so the CI check the last row named wouldn't have caught one. The neighbours gain a reload and the other side of a breakpoint or an allowlist; two accepted reasons (a branch in a script or a workflow, a limitation the owner kept), a behavior removed on purpose, and any PR adds the blind spot it meets, with a row for desktop Safari (A·gap 12, B·gap 1, G·gap 1, H·gap 1). Vitest puts back spies, globals and env before each test, and a test removes its own listeners and fake timers (F: 1 `clear` and 2 `gap`). What a test may count besides mocks (D·gap 3). Each operand of an `&&` chain, and outcomes that look alike (K·gap 3 of 4). A check that reads a file as text is layer 1 (C·gap 1). The template's Layer hint names the six layers and the duplicates (C·clear 4). A `/code-review` bug is recorded under A in the round that reports it (4 were left out). A merge of `main` that doesn't reach the PR's own lines takes a `Merged main` comment instead of a round (4 rounds after a merge alone found nothing: #237, #240, #243, #244), `CHANGELOG.md` merges with `merge=union`, and the author answers each round with `Fixes for round <n>`, which also asks for the docs grepped again after the fixes (H·clear 10, 3 of them in #233 itself, otherwise claims by meaning no grep finds). CI mutates every push to a ready PR's head, the latest one only, so a round reads CI's comment at the commit it reviews rather than running the mutants itself (about 11 local runs in this batch, one of which couldn't run: #246). The basis is production code, `tmdb-proxy/` included. Not changed: K·clear 3 (three different slips), F·clear's `saying()` 2 |
| 2026-11-03 | #207–#229, 10 merged (#207, #208, #222–#229; #209–#221 are issues), 6 with changes in `src/` or `server/` (#224–#229). 30 findings: 11 `clear`, 19 `gap`, 0 `conflict` | 5 of 10 reviewed (#207, #208, #223, #226, #229), 2 of 6 with code (#226, #229); a posted "ready to merge" at the head of all 10 | 1.33 (8 in the 6 with code: #224 3, #228 3, #225 2) | 2 closed since 2026-11-02 (1 `fake-drift`: #209; 1 `environment`: #210), no `flaky` | This PR also carries the 2026-11-02 row's follow-up, which never landed. The neighbours gain the edges and typing that replaces the history entry; three accepted reasons (a layout measured in the CI image, every environment a blind spot runs in, the platform's own behavior); what Stryker leaves alone is listed and broken by hand, and a survivor that only a test's reset hides isn't equivalent (A·gap 4 here and 7 in the last batch, K·gap 2 and 3). The template asks for each neighbour and a `Broken by hand` line (A·clear 5 here and 10 in the last batch); if A·clear doesn't fall by the next retro, a CI check that those lines are filled is the next step. The template's docs prompt greps for the numbers and names the diff changes (H·clear 3 and 5). Lists in the docs follow the change, a fix's manual check says what it needs to pass, and the columns here say what they divide by (H·gap 7). A flush at no delay is a real timer, an absence is asserted by name, test data carries no behavior the test isn't about (F·gap 3). One wording for three `environment`, in the class table and the pile (the conflict #222's code review named). Check J leaves the skill, with no finding in four batches (#136–#229); its rule stays in [Coverage](#coverage) |
| 2026-11-02 | #196–#206, 9 merged, 7 with changes in `src/` or `server/`. 38 findings: 25 `clear`, 12 `gap`, 1 `conflict` | 2 of 9 reviewed, 2 of 7 with code (#198, #206); a posted "ready to merge" at the head of all 9 | 1.71 (12 in the 7 with code: #204 6, #199 2, #200 2, #201 1, #202 1) | 5 closed since the last retro (2 `uncovered`: #194, #147; 3 `environment`: #175, #197, #203), plus 1 `flaky` (#145) | The phone check runs on a production build, `preview-lan` for a PR and Kinoseed Edge before a release, since `dev-lan` has no manifest (#197 and #203 of the 3 `environment` showed in the installed app; #175 shows in a Safari tab too). iOS stays a blind spot: layer 6 took what it could (#197 in #199), and neither WebKit in Playwright nor a simulator in CI would see the Home Screen app. The rest follows in a docs PR of its own after 0.6.1 (A·gap 7, A·clear 10, H·clear 5, and the two wordings of what three `environment` call for). Not changed: F·clear 3 (three different rules) |
| 2026-10-30 | #163–#193, 14 with code | 4 of 16 reviewed, 3 of 14 with code; #179 merged without a round, the one breach of the gate | 1.36 (19 in the 14 with code) | 12 closed since the last retro (10 `uncovered`, 2 `environment`), plus 1 `flaky` (#190) | `npm run test:mutants` and one CI run per PR head, survivors accounted for in the PR (A·clear 12, K·clear 4, B·clear 2). The neighbours of a change (10 `uncovered`). A second copy inside a file, fake timers, comments on assertions (F·gap 4). Who owns a test, and the set behind a retro's counts (H·gap 3). A docs prompt in the template, and wrapping is no finding (H·clear 8). The `flaky` class (I·gap 1). A `/code-review` bug is recorded under check A, which the skill now says, so A will rise next retro. Checks D and K in the skill point here. The gate stays as it is, docs-only PRs included |
| 2026-10-29 | #136–#162, 10 with code | 2 of 11 reviewed (10 with code and #136) | 0.9 (9 in the 10 with code), plus 3 in #136 | 10 closed since the last retro (8 `uncovered`, 2 `environment`) | Every round is posted with the commit both reviews saw, and a PR merges only on a posted "ready to merge" at its head. Nothing else: most of the batch and every escaped bug were written before #136, so the next batch judges the new rules |
| 2026-10-28 | #116–#135, 16 with code | 3 of 16 | 1.25 (20) | 0 | Layers 2 and 3 renamed and widened, mock assertions, a test that can fail, wiring places, error paths, routes and fakes, baselines, the Tests table, the review rounds, this section, TZ pinned to UTC |

## Screenshot tests

Unit tests run in jsdom, which has no layout, so they can't catch a button in the wrong place or a title that doesn't clamp. Screenshot tests do: Playwright opens the built app (`vite preview`) in Chromium and compares each screen with a baseline PNG.

- **What's covered:** what only the browser sees, one baseline per layout or state, in the dark theme and Russian unless said otherwise. Specs are in `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`.
  - A phone (390×844): Downloads (list and poster grid, the sort and filter sheet, the actions sheet, selection, empty, offline, Kinopeer unreached before the first answer and after one, with Retry and Open again, the sticky filter bar after a scroll, also with a notched iPhone's safe area, which a DevTools override gives Chromium), Search (browse rows, results, a next page that failed, the pinned field after a scroll, also with a notched safe area), the title page (movie and series, and the page scrolled under the pinned Find releases bar), Releases (results, the filters sheet, the add sheet, also with too little free space, and its file picker), torrent details (with files, a guessed title, changing the title, changing the category, an error), Settings (and a connection with an error, and Prowlarr without indexers) and the connect screen with a wrong password and with Kinopeer unreached (the state in place of the form, Retry and Open again).
  - A tablet (768×1024): Downloads in the centered column, with the tab bar over it.
  - Desktop (1440×900): the sidebar with labels, Downloads as a grid (and a card's Pause button on hover, and the offline banner with Kinopeer unreached, both buttons beside the text) and as a table (the row and sort menus, selection, offline, the sticky header and column names after a scroll, the header with a notched safe area, the install card above it, and the card left open where it doesn't show, which takes no room), Search (the pinned field after a scroll, no results), the title page (incl. the long overview with Show more), releases under the hero with a filter popover and sorted by a column's name, the torrent drawer over Downloads and over the title page, the add and delete modals, Settings and onboarding (also with Kinopeer unreached, the state in the form's card). The icon rail (1024×768) in the status menu, Search's pinned field after a scroll, releases and Settings; the labelled sidebar at its narrowest (1100×800) and full HD (1920×1080) for the table's columns.
  - The light theme in English twice, where its colors show on every status and on the sidebar: the Downloads list on the phone and the grid on desktop.
  - A behavioral `expect` in a spec only gets a screen to its state, or checks what jsdom can't see (where a click lands, sticky positioning, a container query, a real `<dialog>`); behavior itself is layers 1–4.
- **No live services:** `e2e/app.ts` answers `/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api/settings` and `/api/matches` from the shared fixtures (`src/test/fixtures.ts` through `e2e/fixtures.ts`), matched by URL pathname (a glob like `**/tmdb/**` would also catch Vite's `/src/api/tmdb/` modules). Posters are generated gradients and the release's `.torrent` is built from the fixtures too. The app version in Settings is masked, so a version bump doesn't change the screenshots. The clock is frozen, animations are off and the service worker is blocked. Text is always grayscale (`--disable-lcd-text` in `playwright.config.ts`): left to itself, Chromium now and then draws part of a page's text in grayscale instead of LCD, as it did in two screenshots in CI (#145). What triggers it wasn't found, and a page can't see it, so a test can't wait it out.
- **Docker only:** fonts render differently on macOS and on other Linux setups (about 1% of pixels, enough to fail), so baselines are rendered only in the Playwright image. `npm run test:visual` runs the tests in it with Docker; `node_modules` for the container is kept in a Docker volume, not the host's. Arguments go to `playwright test`, e.g. `npm run test:visual -- e2e/search.spec.ts`.
- **Parallel worktrees:** each checkout, every git worktree included, gets its own `node_modules` volume, `kinopeer-visual-nm-<folder>-<checksum of its physical path>` (`scripts/playwright-docker.sh`, shared with the README screenshots), so runs in several worktrees at once don't reinstall it under each other. A run installs only when the volume wasn't installed from this `package-lock.json`, in this image, for this architecture (`scripts/install-node-modules.sh`, a stamp in the volume says which), so the first run in a worktree takes a minute longer and later ones skip `npm ci`. Since `npm ci` no longer runs every time, a run that fails inside `node_modules` (a missing module, a binary for another platform) is fixed by removing that checkout's volume and running again. Two runs in the same checkout still share `test-results/` and the baselines, so run one at a time there. Each volume takes about 250 MB, so it's labelled with its checkout's path (`kinopeer.checkout`), and every run removes the labelled volumes whose folder no longer exists, as a worktree's once its session is cleaned up; Docker refuses one a running container uses, and the next run tries again. Volumes without the label are never removed automatically: those made by hand, before the label or before the rename to Kinopeer (`kinoseed-visual-node-modules*`, every `kinoseed-visual-nm-*`, whose `kinoseed.checkout` label the cleanup no longer reads) go once by hand: `docker volume ls -q --filter name=kinoseed-visual | xargs docker volume rm`, and `docker volume rm <name>` for a hand-named one.
- **Changing the UI:** a PR that changes how a covered screen looks updates its baselines. First run `npm run test:visual` as is: every failed screenshot leaves an expected, an actual and a diff image in `test-results/`, where the diff highlights only the changed pixels. Make sure nothing but the intended change is highlighted, then re-render with `npm run test:visual:update` and commit the PNGs (GitHub shows image diffs in the PR too). A change too small to fail its screenshot (a hover shade, a pixel of padding) is under the threshold, and the plain update keeps the old PNG: re-render that spec with `npm run test:visual -- --update-snapshots=all e2e/<spec>.spec.ts` and commit only the PNGs of the screens you meant to change. Open every new baseline and check that it shows what its test's name says. The PR lists each PNG with what changed and how it was checked: the diff looked at, re-rendered with `=all`, or new and opened. Each change on a screen is either intended, what the PR sets out to change, or a side effect: a shift, a swap or something gone on a screen or in a state the task didn't touch. A side effect isn't accepted by describing it: one visible to the eye goes to the owner as a question before the merge, in the PR's own **For the owner** section, with the before and after images, and the PR merges once the owner has answered it; a change only the diff image shows (a pixel of anti-aliasing) isn't one (#324, where a swap of the header's rows, described in #100's list, stayed for two weeks). Add a spec when a new screen, sheet, dialog or state needs one ([Saying why something is uncovered](#saying-why-something-is-uncovered)).
- **In CI:** the `visual` job runs in the same image, on two workers (`playwright.config.ts`; locally Playwright picks). When it fails, its `playwright-report` artifact has the expected, actual and diff images.
- **Upgrading Playwright:** `@playwright/test` in `package.json`, the image tag in `scripts/playwright-docker.sh` and `.github/workflows/ci.yml` must name the same version, and both pin the image by the digest that tag names (`docker buildx imagetools inspect mcr.microsoft.com/playwright:v<version>-noble`, the `Digest` line); re-render the baselines after an upgrade.

### README screenshots

`npm run screenshots:readme` re-renders the screenshots in `docs/screenshots/` (`e2e/readme.shots.ts`, config `playwright.readme.config.ts`): six phone screens and five desktop ones (three of them only for the Umbrel App Store, which makes its gallery from screenshots like these), dark theme, English like the README; a list of torrents waits until every row has its poster. It runs in the same Playwright image, but on the dev server, so titles and posters come from TMDB for real; qBittorrent and Prowlarr answer from the fixtures. TMDB needs no key of your own: the dev server goes through Kinopeer's edge TMDB proxy ([DEVELOPMENT.md](DEVELOPMENT.md) → The TMDB proxy), and a `TMDB_API_KEY` in the environment or `.env.local` goes to TMDB directly instead. They run the checked-out branch, so a branch that adds a TMDB path needs a key until it merges: the edge worker answers 404 for a path it hasn't deployed. Retake them when a screen in the README changes noticeably, check the PNGs and commit them; nothing compares them in CI.

## Smoke journeys

The other half of layer 6: six journeys (`e2e/smoke/*.smoke.ts`, `npm run test:smoke`) drive the
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
  Retry alone while the device is offline, then Open again beside it, which loads the page past the worker (#311); the caches hold posters and never `/qbt/`, `/prowlarr/`, `/tmdb/` or `/api/`. The proxy's cookie lapsing under the service worker (#303): a reload is answered from the cache, the app's first requests come back redirected to the proxy's sign-in, and the app loads its screen through the proxy once with `proxy-sign-in`, which the worker leaves to the network, gets the cookie, takes the parameter out of the address and shows its data. The tabs
  on a phone: each comes back to where it was left once its content is in, the position read as a
  screen goes away being the one the user left rather than the next screen's, clamped; a reload of
  an entry a tab's link opened (the browser keeps its history state) comes back to where the user
  was on it; and the active tab scrolls to the top, which only a real browser's scrolling shows. Every
  journey also asserts the proxy refused nothing, so every fetch carried its cookie, and, through
  the `test` they import from `e2e/smoke/test.ts`, that the Content-Security-Policy blocked nothing
  the built app loads or runs.
- **What they don't.** Looks (the screenshot tests), and the branches of a flow (an error, an
  empty state, a second qBittorrent version): a journey goes through once; its variations belong
  to the layers above, which run in milliseconds.
- **The stand** (`e2e/smoke/stack.ts`) starts the fakes from `server/test/fakes.ts`, a data
  directory of its own (`mkdtemp`) and the server (`node server/main.ts` with `PORT`,
  `KINOPEER_DIST=dist`, `KINOPEER_DATA_DIR`, the fakes' addresses in `QBITTORRENT_URL`,
  `PROWLARR_URL`, `TMDB_API_URL` and `TMDB_IMAGE_URL`, and no login or key unless asked), and in
  front of it a reverse proxy on the tests' `baseURL` that stands in for Umbrel's app_proxy: a
  page load gets a session cookie, and every other request without it is redirected to a sign-in
  on another origin (marked with a header of its own), as Umbrel's app_proxy does, so a fetch
  without the cookie fails its journey.
  The journeys run in another process, so the stand has a control server (`e2e/smoke/control.ts`):
  `resetStand()` restarts the server with a fresh data directory and fresh fakes in the state a
  journey wants (configured or not, which torrents, which matches), and `standState()` reads what
  the fakes saw (`seen`, `added`, `deleted`, the login count, the list) and what the server saved
  (`settings.json`, `matches.json`). Playwright starts the stand as the config's `webServer`
  (`playwright.smoke.config.ts`: `npm run build && node e2e/smoke/stack.ts`, the proxy on 4300,
  the server on 4310 and the control server on 4320, one worker, service workers allowed). Locally
  it reuses a stand already running: for a quick loop, build once, start
  `node e2e/smoke/stack.ts` yourself and run `npx playwright test --config playwright.smoke.config.ts`.
- **Adding a journey:** a `*.smoke.ts` in `e2e/smoke/` that imports `test` and `expect` from `./test.ts` (oxlint refuses them from `@playwright/test` there), starts with `resetStand(…)`, drives
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

## The requests test

The third kind of layer-6 test: `e2e/performance/requests.perf.ts` (`npm run test:requests`, after
`npm run build`; config `playwright.performance.config.ts`) opens each screen afresh by its
address in Chromium, on a phone and on desktop, with the server routes mocked by `e2e/app.ts` as for
the screenshots, and counts the requests it sends by route against `budgets.requests` in
`checks.json`. Beside it, `e2e/performance/journeys.perf.ts` (the same config and command) makes
short journeys between screens the way a person does, and counts each move's requests against
`budgets.journeys`. What they count, why the counts are exact, what a failure says and what to do about
it are in [QUALITY.md](QUALITY.md) → The requests budget.

- **What it checks, that nothing else does.** How many requests a screen's open costs, which only a
  real browser shows: the screens' own requests and their hooks', the lazy images it loads, the
  timers it sets off. A layer-3 test asserts a count only where the count is the behavior of one
  screen or hook; this test counts them all, per route, for every screen. The journeys do the same
  for a move between screens: what a screen asks when it's reached from another, a request for what
  the screen before already had.
- **What they don't.** The next poll, an action that changes something (adding, pausing, deleting),
  a sheet or menu opened, the looks and the flows. A count it shows to be too high is fixed in the app, with a test
  on the lowest layer that sees the duplicate, and the budget lowered in the same PR.
- **Their pure rules** (`scripts/requests/budget.ts`) are layer 1; the browser tests only collect
  the numbers and hand them there, and share what they do with the page (`e2e/performance/page.ts`).
  Each sets its own torrents and runs the clock itself through
  `prepareApp` (`e2e/app.ts`), which `openApp` uses too, with the clock frozen instead.
- **A new screen** opened by its address in the screenshot tests gets a row in its `SCREENS` and a
  budget for each window size, which goes to a second review. A screen taken out of `SCREENS` takes
  its budgets with it, which goes to the owner. A new journey or move gets its place in
  `JOURNEYS_MADE` and a budget for each move in each window size, which goes to a second review.
- **What it leaves out.** The other states of its screens that the screenshot tests open (other
  torrents' pages, a search that finds nothing, onboarding), whose counts would follow the shared
  fixtures' options more than the app: QUALITY → The requests budget lists them.
- **Locally** it starts its own `vite preview` on port 4174 and fails when the port is taken,
  rather than count another build's requests; it serves what `dist/` has, so build first.
- **In CI:** the `performance` job runs them on a plain runner after the size budget, with Chromium
  cached by the Playwright version; it adds the tables of the counts to the job's summary, and when
  it fails, its `playwright-report-performance` artifact has the report and the traces.

## The layout shift test

`e2e/performance/layoutShift.perf.ts` (the same config, command and CI job as the requests test)
opens a torrent's page by its address, on a phone and on desktop (its drawer over Downloads), and
sums its layout shifts as it loads, the `layout-shift` entries without recent input, against
`GOOD_LAYOUT_SHIFT` (0.1, the bound Web Vitals call good). It was #387's red test: on a phone the
page moved by 0.26.

- **Not by chance.** Which states of a page paint, and so what can move, depends on the order its
  answers land in, which a run left to the network doesn't choose. `holdAnswers`
  (`e2e/performance/layoutShift.ts`) holds each route's answers and lets them land in an order the
  test names, each after the page painted what the one before showed: every state in between is on
  the screen for a frame at least, the worst case. The page asks for the session, the torrents, the
  title and the poster in that order whatever the network does; the server's matches are asked for
  beside them, so the test lands them at each place in that chain.
- **What a failure says.** Each shift with the elements that moved, their boxes in the viewport
  before and after (`y/height`). A shift comes from an element that was on the screen before and
  is somewhere else after; one that appears doesn't count, so the fix is room kept for what loads
  later, or the same element kept where it was (#387: the loading state's body became the loaded
  page's header).
- **What it leaves out.** Other screens; a check of every screen's layout shift is to come with
  #378, extending this reading. It runs with reduced motion, as every Playwright test here does,
  where #387's jump showed: the reduced-motion rule in `src/styles/base.css` gives every element a
  1 ms transition, so an element whose styles change is drawn once more as it was.

