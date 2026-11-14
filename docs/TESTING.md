# Testing

How Kinopeer's tests are organized: six layers, each with one job, and how to choose one; what to
do with a bug; what no layer sees; the shared test data and the fake services; coverage and its
threshold; how a PR's tests are reviewed and how its findings are tagged for the retro; the
screenshot tests and the smoke journeys. Running and releasing are in
[DEVELOPMENT.md](DEVELOPMENT.md); the checks guard, which marks a PR that weakens the checks, in
[QUALITY.md](QUALITY.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

The rules here that any project could use (choosing a layer and the neighbours of a change, a
test that can fail, the accepted reasons for something uncovered, what to do with a bug and its
seven `test-gap` classes, keeping a list of blind spots, reviewing a PR's tests and tagging its
findings) are also the quality system's testing component, **version 1 (2026-11-14)**, which other
projects copy. This file is that component's source, not a copy: the component was written from
it, in project-neutral words, and lives in the owner's private repository (`ai-workspace`,
`quality-system/testing.md`), which outside contributors can't open, so everything needed to work in
Kinopeer stays here. A section that holds the component's rules says so under its heading; the
rest (the layers, the blind spots' table, the fixtures, the fakes, coverage, the lint rules, the
browser tests) is Kinopeer's own. A change to one of the component's rules here goes into the
component too, as its next version. The retro that reads the review
findings and the escaped bugs is the whole quality system's: [QUALITY.md](QUALITY.md) → The retro.

```sh
npm test                    # layers 1–5 (Vitest), single run
npm test -- --project app   # only the jsdom tests (src/)
npm test -- --project server  # only the server and integration tests (server/)
npm run test:coverage       # the same with coverage and its threshold: a table in the terminal, coverage/index.html
npm run test:mutants        # breaks the lines this branch changes, lists the breaks no test noticed
npm run test:visual         # layer 6: screenshot tests in Docker, each screenshot's state read by axe against its accessibility budget
npm run test:visual:update  # re-render their baselines
npm run test:smoke          # layer 6: smoke journeys through the production server, no Docker
npm run test:requests       # layer 6: each screen's requests on opening and each move's between screens against their budgets, and each screen's layout shift on a phone, after npm run build
```

## Layers

| # | Layer | What it checks | What it doesn't | Tool | Where | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pure logic | Parsing release and torrent names, picking a title, filtering and sorting, formatting, the SHA-1 fallback, the checks guard's signs, its reading of a test file and its comparison of the tests that ran, the size budget's rules, the requests budget's rules, the layout shift budget's rules, the accessibility budget's rules: functions that import no React, DOM or Node APIs | Rendering, the network | Vitest | `*.test.ts` next to the module (`src/releases/`, `src/search/`, `src/torrents/`, `src/logic/`, `src/lib/`, `server/json.ts`, `scripts/guard/` but for `guard.ts`, `scripts/size/budget.ts`, `scripts/requests/budget.ts`, `scripts/layout-shift/budget.ts`, `scripts/accessibility/budget.ts`) | `npm test` |
| 2 | Components and generic hooks | A shared component renders its props with the right roles and names and reacts to input; a hook that knows nothing of the app's data does its job in a DOM (`useIsDesktop`, `useHeightVar`, `useScrollRestoration`, the theme) | Layout and looks, which jsdom has none of; the app's data | Vitest + Testing Library, jsdom | `src/components/*/*.test.tsx`, the hooks in `src/lib/`, `src/theme/` | `npm test` |
| 3 | Screens, stores and clients | A screen or a user flow with the API clients mocked (`vi.mock('../api/…')`): what it shows for a state, what it sends, where it navigates. A hook or a store that holds the app's data, with the clients mocked. An API client with `fetch` stubbed: the request it builds and how it reads each answer, errors included | Real HTTP, the server, layout | Vitest + Testing Library + user-event, jsdom | `src/screens/*.test.tsx` (sheets and dialogs included), `src/App.test.tsx`, the hooks and stores in `src/session/`, `src/torrents/`, `src/settings/`, the clients in `src/api/*/` | `npm test` |
| 4 | Server | Each middleware under `server/` against fake qBittorrent, TMDB and Prowlarr servers started in the test: routing, headers, what reaches the service and what comes back | Browser code | Vitest, Node (`server` project) | `server/*.test.ts`, fakes in `server/test/fakes.ts`; the TMDB proxy worker in `tmdb-proxy/worker.test.ts`, with TMDB and the rate limiter faked in the test, and its deploy check in `tmdb-proxy/deployCheck.test.ts` over a git repository made in the test; the dev and preview servers started from the config in `vite.config.test.ts`; the checks guard in `scripts/guard/guard.test.ts`, over a git repository made in the test; the size check in `scripts/size/size.test.ts`, over a build folder made in the test; the folders `checks.json` mutates against the Mutants workflow's `paths` and the type check in `checks.test.ts`, its readers' spellings over configs made in the test | `npm test -- --project server` |
| 5 | Integration | The real clients in `src/api/*` calling the real `kinopeerServer()` in front of the fakes: both ends of each route agree on paths, bodies, cookies and errors, and the flows that cross several routes (login, adding a release, matches) | Rendering; a server without a route (the SPA fallback), which stays in the client tests | Vitest, Node | `server/integration/*.test.ts`, the stand in `server/test/integration.ts` | `npm test -- --project server` |
| 6 | Browser | How the screens look: the built app in Chromium against baseline PNGs, with every server route mocked, and what axe finds broken in each state they show, against its budget (screenshot tests). And six smoke journeys through the real production server behind a proxy that wants a cookie, with the services faked: the browser and the server together (smoke journeys). And what each screen asks the servers for when it opens, and each move between screens in short journeys, counted against its budget, with the routes mocked as for the screenshots (the requests tests). And how far each screen moves as it loads on a phone, its answers let land one at a time, against its budget (the layout shift test) | Behavior, which the layers above cover faster | Playwright in Docker; Playwright on the host | `e2e/*.spec.ts` through `e2e/test.ts`, baselines in `e2e/__screenshots__/`; `e2e/smoke/*.smoke.ts`, the stand in `e2e/smoke/stack.ts`; `e2e/performance/requests.perf.ts`, `e2e/performance/journeys.perf.ts`, `e2e/performance/layoutShift.perf.ts` | `npm run test:visual`; `npm run test:smoke`; `npm run test:requests` |

Layers 1–5 run on every `npm test` in two Vitest projects (`vite.config.ts`): `app` is jsdom with
`src/test-setup.ts` (jest-dom matchers, the interface language reset to English, Testing Library's
cleanup, a no-op `window.scrollTo` since jsdom only logs "not implemented" for it); `server` is
plain Node for the tests its `include` there names: the server's, the integration tests included,
the TMDB proxy's, the scripts' and the two at the root, `vite.config.test.ts` and `checks.test.ts`. Tests sit next to the code as
`*.test.ts(x)` and query by role and accessible name. Two kinds of test don't follow the table's
"Where" column. The service worker: its routing rules are plain logic in `src/pwa/swRoutes.ts`
(layer 1), and `src/sw.test.ts` is a smoke test of `src/sw.ts` with workbox mocked, compiled with
the worker's `tsconfig.sw.json` rather than the app's. And a check that reads a source file as
text (the tokens and the raw px values, colors, shadows and motion in the stylesheets, and the custom properties they use, `src/styles/tokens.test.ts`; the poll ring's
keyframes, in `PollRing.test.tsx`) is layer 1 wherever it sits, although it reads the file through
`node:fs`: it asserts what the file says, and how that looks is layer 6's (#241). So is a lint
rule's test, which plants what the rule refuses and allows and runs oxlint over it with the root's
config (`lint()` from `src/test/oxlint.ts`; the texts in the app's JSX, `src/i18n/texts.test.ts`, and
the pure modules' imports and globals, `src/logic/pureModules.test.ts`).

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

*The testing component's rules, version 1, in Kinopeer's words ([above](#testing)).*

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
  and a new token or spelling adds its rows there. A check that reads code, config, a workflow or
  CSS (the checks guard, whose workflow reader still goes line by line until #419, `tokens.test.ts`,
  a lint rule's config) reads it with that format's own
  parser (PostCSS's tokenizer, a YAML parser, Vite's `parseSync` (oxc) for TypeScript, `JSON.parse`), not with regular
  expressions, and where comparing it part by part gets intricate, it marks the whole (an oxlint
  override with other `files` is marked whole, #415). The spellings it must catch and the ones it
  must let through go in a table in its test, and a spelling found later adds its row there (41
  blocking and should-fix findings over spellings their readers missed in #367–#370, #410, #411, #414 and #415, which took
  3.6 rounds on average, and #412 reached `main`).

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
  `chooseTitle` saves is `useTitleMatches.test.ts`'s. An argument the test isn't about may be
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
  vi.runAllTimersAsync()` (#224). A browser test (Playwright) waits for what it can see: a
  locator, a response, an event. It waits in real time only for an absence nothing signals, such
  as no request in flight for a while (`settled` in `e2e/performance/page.ts`), with a comment
  saying why and a deadline of its own (#380).

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

*The testing component's rules, version 1, in Kinopeer's words ([above](#testing)).*

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

Each retro looks at the pile ([QUALITY.md](QUALITY.md) → The retro; before 2026-11-10 each
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
did. The retro runs the same count over review findings (the quality system's `retro.md` → What it
reads → The review findings).

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

*The rule in this section's first paragraph is the testing component's, version 1 ([above](#testing)); the table is Kinopeer's.*

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
| Plain HTTP without `crypto.subtle`: reading a `.torrent` with the SHA-1 fallback in a real browser | `src/torrents/digest.ts` on layer 1 against known digests; every browser test runs on localhost, a secure context, where Web Crypto exists | The checklist: add a release over `http://` on the LAN, where the info hash must still match qBittorrent's |
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
  `holdSearches` in `useTitleMatches.test.ts`).
- **`src/test/oxlint.ts`:** `lint(files)` lays the files out as in the repository beside a copy of
  the root's `.oxlintrc.json`, runs oxlint over them as `npm run lint` does and returns each problem's
  rule, file and line, so a rule's test can plant a violation where an override applies. It throws
  when oxlint couldn't read a planted file, skipped one or refused to run, so a check of what a rule allows can't
  pass on a file no rule read.
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
`tmdb-proxy/`, `scripts/guard/`, `scripts/size/`, `scripts/requests/` and `scripts/layout-shift/`, not the config and data files beside it (#283), without the tests themselves, `src/test/`, `server/test/`, type-only modules and the `index.ts` barrels of
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

*The testing component's rules, version 1, in Kinopeer's words ([above](#testing)).*

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
   #332 left a change out, #323 and #339 claimed more). A doc about how things are now doesn't copy
   a count or a list that the code or CI holds (the keys of a budget, the folders a config names,
   the callers of a function, a measured value): it says what that is and where it lives, so
   nothing is left to fall behind (#379's skill and #388's `mutants.yml` and `tsconfig.node.json`
   each missed a folder `checks.json` had gained; #340 and #388 stated counts the head didn't have,
   #379 a size measured over a stale `node_modules`). A dated record (SPEC's decision log, a retro's row, a trial's report) keeps its numbers as
   of its date. Each list the change adds to gets the new item (the
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
([QUALITY.md](QUALITY.md) → The retro). A PR's CI doesn't run everything they move:
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

*The testing component's rules, version 1, in Kinopeer's words ([above](#testing)).*

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

The retro that reads them, every fifty merged PRs, is the whole quality system's, not only the
tests': [QUALITY.md](QUALITY.md) → The retro, with the table of past retros. A `conflict` doesn't
wait for it: the reviewer says in the report what disagrees with what, and the next docs PR settles
it.

## Screenshot tests

Unit tests run in jsdom, which has no layout, so they can't catch a button in the wrong place or a title that doesn't clamp. Screenshot tests do: Playwright opens the built app (`vite preview`) in Chromium and compares each screen with a baseline PNG.

- **What's covered:** what only the browser sees, one baseline per layout or state, in the dark theme and Russian unless said otherwise. Specs are in `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`.
  - A phone (390×844): Downloads (list and poster grid, the sort and filter sheet, the actions sheet, selection, empty, offline, Kinopeer unreached before the first answer and after one, with Retry and Open again, the sticky filter bar after a scroll, also with a notched iPhone's safe area, which a DevTools override gives Chromium), Search (browse rows, results, a next page that failed, the pinned field after a scroll, also with a notched safe area), the title page (movie and series, and the page scrolled under the pinned Find releases bar), Releases (results, the filters sheet, the add sheet, also with too little free space, and its file picker), torrent details (with files, a guessed title, no title found with the dot on More, also in the light theme, and its menu with Match title in the accent, fixing the match, changing the category, an error), Settings (and a connection with an error, and Prowlarr without indexers) and the connect screen with a wrong password and with Kinopeer unreached (the state in place of the form, Retry and Open again).
  - A tablet (768×1024): Downloads in the centered column, with the tab bar over it.
  - Desktop (1440×900): the sidebar with labels, Downloads as a grid (and a card's Pause button on hover, and the offline banner with Kinopeer unreached, both buttons beside the text) and as a table (the row and sort menus, selection, offline, the sticky header and column names after a scroll, the header with a notched safe area, the install card above it, and the card left open where it doesn't show, which takes no room), Search (the pinned field after a scroll, no results), the title page (incl. the long overview with Show more), releases under the hero with a filter popover and sorted by a column's name, the torrent drawer over Downloads (also with no title found, and its menu open) and over the title page, the add and delete modals, Settings and onboarding (also with Kinopeer unreached, the state in the form's card). The icon rail (1024×768) in the status menu, Search's pinned field after a scroll, releases and Settings; the labelled sidebar at its narrowest (1100×800) and full HD (1920×1080) for the table's columns.
  - The light theme in English twice, where its colors show on every status and on the sidebar: the Downloads list on the phone and the grid on desktop.
  - A behavioral `expect` in a spec only gets a screen to its state, or checks what jsdom can't see (where a click lands, sticky positioning, a container query, a real `<dialog>`); behavior itself is layers 1–4.
- **Accessibility:** every screenshot also has axe read the state it shows, the whole page for a screenshot of an element, against WCAG 2.2 AA as axe checks it, and compares the count of elements that break each rule with its budget under `budgets.accessibility` in `checks.json`. The read is inside `toHaveScreenshot`: the specs and the modules they share steps from (`app.ts`) take `test` and `expect` from `e2e/test.ts`, not from `@playwright/test` or `playwright/test`, which oxlint refuses in every file under `e2e/` but `test.ts` and the smoke and performance tests (their default export and `mergeExpects` too), so a new screenshot can't be taken without it. A new screenshot gets its budget in the same PR: its test fails without one, naming what to add. What the reads find, why a count must equal its budget and what fails are in [QUALITY.md → The accessibility budget](QUALITY.md#the-accessibility-budget).
- **No live services:** `e2e/app.ts` answers `/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api/settings` and `/api/matches` from the shared fixtures (`src/test/fixtures.ts` through `e2e/fixtures.ts`), matched by URL pathname (a glob like `**/tmdb/**` would also catch Vite's `/src/api/tmdb/` modules). Posters are generated gradients and the release's `.torrent` is built from the fixtures too. The app version in Settings is masked, so a version bump doesn't change the screenshots. The clock is frozen, animations are off and the service worker is blocked. Text is always grayscale (`--disable-lcd-text` in `playwright.config.ts`): left to itself, Chromium now and then draws part of a page's text in grayscale instead of LCD, as it did in two screenshots in CI (#145). What triggers it wasn't found, and a page can't see it, so a test can't wait it out.
- **Docker only:** fonts render differently on macOS and on other Linux setups (about 1% of pixels, enough to fail), so baselines are rendered only in the Playwright image. `npm run test:visual` runs the tests in it with Docker; `node_modules` for the container is kept in a Docker volume, not the host's. Arguments go to `playwright test`, e.g. `npm run test:visual -- e2e/search.spec.ts`.
- **Parallel worktrees:** each checkout, every git worktree included, gets its own `node_modules` volume, `kinopeer-visual-nm-<folder>-<checksum of its physical path>` (`scripts/playwright-docker.sh`, shared with the README screenshots), so runs in several worktrees at once don't reinstall it under each other. A run installs only when the volume wasn't installed from this `package-lock.json`, in this image, for this architecture (`scripts/install-node-modules.sh`, a stamp in the volume says which), so the first run in a worktree takes a minute longer and later ones skip `npm ci`. Since `npm ci` no longer runs every time, a run that fails inside `node_modules` (a missing module, a binary for another platform) is fixed by removing that checkout's volume and running again. Two runs in the same checkout still share `test-results/` and the baselines, so run one at a time there. Each volume takes about 250 MB, so it's labelled with its checkout's path (`kinopeer.checkout`), and every run removes the labelled volumes whose folder no longer exists, as a worktree's once its session is cleaned up; Docker refuses one a running container uses, and the next run tries again. Volumes without the label are never removed automatically: those made by hand, before the label or before the rename to Kinopeer (`kinoseed-visual-node-modules*`, every `kinoseed-visual-nm-*`, whose `kinoseed.checkout` label the cleanup no longer reads) go once by hand: `docker volume ls -q --filter name=kinoseed-visual | xargs docker volume rm`, and `docker volume rm <name>` for a hand-named one.
- **Changing the UI:** a PR that changes how a covered screen looks updates its baselines. First run `npm run test:visual` as is: every failed screenshot leaves an expected, an actual and a diff image in `test-results/`, where the diff highlights only the changed pixels. Make sure nothing but the intended change is highlighted, then re-render with `npm run test:visual:update` and commit the PNGs (GitHub shows image diffs in the PR too). A change too small to fail its screenshot (a hover shade, a pixel of padding) is under the threshold, and the plain update keeps the old PNG: re-render that spec with `npm run test:visual -- --update-snapshots=all e2e/<spec>.spec.ts` and commit only the PNGs of the screens you meant to change. Open every new baseline and check that it shows what its test's name says. The PR lists each PNG with what changed and how it was checked: the diff looked at, re-rendered with `=all`, or new and opened. Each change on a screen is either intended, what the PR sets out to change, or a side effect: a shift, a swap or something gone on a screen or in a state the task didn't touch. A side effect isn't accepted by describing it: one visible to the eye goes to the owner as a question before the merge, in the PR's own **For the owner** section, with the before and after images, and the PR merges once the owner has answered it; a change only the diff image shows (a pixel of anti-aliasing) isn't one (#324, where a swap of the header's rows, described in #100's list, stayed for two weeks). Add a spec when a new screen, sheet, dialog or state needs one ([Saying why something is uncovered](#saying-why-something-is-uncovered)), with `test` and `expect` from `./test.ts`.
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
opens each screen of `e2e/performance/screens.ts`, the list the requests test opens, by its address
on a phone (390×844) and on desktop (1440×900, the screenshot tests' `DESKTOP`), and sums its layout
shifts as it loads against its budget for that size, `budgets.layoutShift.phone` or `.desktop` in
`checks.json`; a screen may have several cases, states of it whose blocks differ, and its budget
covers them all. A state that moves only in a narrower desktop window is read there too, as a size
of its own with only that screen's budget (`desktop-rail`, 1024×768, the screenshot tests'
`DESKTOP_RAIL`, and `desktop-1280`, 1280×800, a laptop's window with the labeled sidebar); the sizes
are named in the file (`VIEWPORTS`). It began as #387's red test (on a phone a torrent's
page moved by 0.26) and #389's (a guessed title's page moved by 0.1051 as "Is it right?" came in
above the progress card); QUALITY → [The layout shift budget](QUALITY.md#the-layout-shift-budget)
has the budgets' rule.

- **Every answer held.** Which states of a screen paint, and so what can move, depends on the order
  its answers land in, which a run left to the network doesn't choose. `holdAnswers`
  (`e2e/performance/layoutShift.ts`) holds every request the page sends but the document and the
  build's own files, and lets the case's answers land one at a time, each after the one before
  landed whole and the page painted a frame: every state in between is on the screen for a frame
  at least, the worst case, but for the titles in Downloads (What it leaves out). An
  answer's later requests (another poster, the next poll) land as they come once it has. The web
  font's files are the build's and aren't held: every painted frame the test waits for, the first
  before any answer lands, comes after the page's fonts are ready (`document.fonts.ready`), as a
  page the service worker serves has them, so when they arrive doesn't change a reading.
- **The reading waits for the screen complete.** Between answers, the next one's landing holds
  what the one before brought (but for the titles in Downloads, below); after the last, nothing
  does. So once the last answer has landed,
  the test waits for what the case's screen shows when it is complete (`complete` in
  `layoutShift.perf.ts`: its headings and links, every poster loaded and shown, the description on
  More of a torrent without a title, each service's status and the category selects in Settings),
  then for a painted frame, and reads. A condition on the page, not a time: what an answer brings
  can show later than it lands (a title in Downloads with the next show, `SHOW_EVERY_MS` later, a
  poster once its image loads). Each wait was seen red with the screen's last state shown 250 ms
  late, the page moving 130px with it: over the budget with the wait, under it without, in both
  orders. On the title's and the series' pages, in the order where the download defaults (which
  show nothing there) land last, other answers land after the "In downloads" block, and their
  landing holds it: it took the block 3 s late to get past them, while at 250 ms and 1 s the
  reading was over the budget without the wait too (#395's second review). On desktop every case
  also waits for the sidebar's qBittorrent card to say its free space, which it shows once the
  torrents land: with the card's last state shown 250 ms late and a 130px block in it, browse,
  search, search-year and settings read 0.0071 with the wait and 0.0008 without it in six of their
  eight loads (#402's review).
- **The chain comes from the code.** Each case names its answers and, for each, the answers the
  page waits for before it asks (`after`, all of them, or `afterAny`, one of them), read from the
  screen's code: the table below. The test holds the chain to the page: a request asked before the
  answers its chain waits for were let go fails the load at once, in either order, naming it. An
  answer the chain says is due that the page doesn't ask for in 10 s fails the load too, in the
  order where the page is still waiting for another answer, which may be only one of the two. So a
  chain that's wrong fails rather than reads by chance. The same address asked twice is two answers, in the order
  asked (the session's check of the server's settings, then the download defaults' load of them);
  `claimant` in `scripts/layout-shift/answers.ts` decides which a request is.
- **Two orders, by a rule.** Answers out at the same time land in two orders, each a test: the one
  the page asked for first lands first, or the one it asked for last (`pick`), among those held.
  Before each choice the test waits for every answer the chain says is due once those landed so
  far to have been asked, so what is held when it chooses comes from the chain and the order the
  page asks in, not from how fast it asked: the choice is the same every run. A chain whose every
  answer waits for the one before it can't give two orders, and runs once (`orders`); every chain
  today has a point with two answers out (the download defaults beside the screen's first), so
  every case runs twice. The orders do differ where it matters: before #394's fix a movie's page
  read 0.0002 in CI when the torrents landed before the details and 0.0878 the other way, and the
  fix's first version read 0 one way and 0.0608 the other.
- **Nothing lands unheld.** A request no answer of the case is lands, and fails the test with its
  method and address: a screen that starts asking for more brings its case along. So does a request
  beyond the answers that claim it, the same address again or with another query, unless the last
  of them takes later requests as its own (`later`): the torrents' poll, every 2 s, and the posters
  after the first.
- **What the reading counts.** Every `layout-shift` entry, with the elements that moved and their
  boxes in the viewport before and after (`y/height`), those within 500 ms of a click or a key
  press too, which web-vitals leaves out: the failure marks them "after input", and a screen
  reached by a click is still read. A browser without the entry type fails the reading rather than
  record nothing. A shift comes from an element that was on the screen before and is somewhere
  else after; one that appears doesn't count, so the fix is room kept for what loads later, or the
  same element kept where it was (#387: the loading state's body became the loaded page's header).
- **Reduced motion and the size are the file's own.** It runs under reduced motion, where the
  rule in `src/styles/base.css` cuts every transition out, so an element that moves is read in the
  frame it moves rather than across a transition's frames, and a style change shows in its own
  frame, as it does for everyone with motion on where the element declares no transition. Until
  #390 that rule gave every element a 1 ms transition instead, so an element whose styles changed
  was drawn once more as it was: it made #387's jump and hid most of #405's table (0.0140 read
  against 0.0888 with motion on). Both are set in the test, not taken from the configs it builds
  on: the share of the window that moves is the score, so each size reads its own number.
- **Exact.** Every case in each order read the same number in every run, to the fourth digit: ten
  runs in a row locally (macOS) and in CI (Linux). On a phone every reading in CI has 0.0002 more
  than on a Mac, which varies in its sixth digit (0.000179 or 0.000183): the "Connecting" text,
  before any answer, moves sideways as the font comes in, in one shift or two. On desktop, read in
  five runs on a Mac and in CI at #402's head, CI reads up to 0.0002 more (downloads and the
  torrent's drawer), 0.0001 (the title's and the series' page in one order, `desktop-1280`) or the
  same (the rest). The budgets come from CI's
  readings. A reading that varies by more is a race in the test (an answer whose content wasn't
  waited for) to find, not noise to budget, but for a jump planted among the titles in Downloads,
  which can read one of two numbers (What it leaves out).
- **The rules** (the budgets read with their ceiling, the sum, the verdict and its report, the
  screens without a case or a budget, the table of readings; and which answer a request is, which
  are due, which lands next, how many orders a chain gives, what is wrong with a chain) are pure
  functions in `scripts/layout-shift/budget.ts` and `answers.ts`, tested beside them (layer 1);
  coverage measures the folder and Stryker mutates it. One test checks that every screen of the
  list has a case on a phone and on desktop, that a narrower size reads only screens of the list,
  and that every screen read has a budget at its size and every budget a screen read there. The reporter
  (`e2e/performance/summary.ts`) adds a table of every load's reading to the job's summary.
- **A new screen** in `screens.ts` gets a case here, with its chain from its code, and a budget,
  which goes to a second review. A new late block on a screen (one that appears after the screen's
  first paint because an answer landed) goes into the table below and into a case that shows it.

| Screen | Answers, in their chain | Late blocks | Cases |
| --- | --- | --- | --- |
| Every screen | qBittorrent's version; then the server's settings (whether onboarding asks for a TMDB key), after which the screen paints; then the server's settings again (the download defaults) | The screen itself, in place of "Connecting" | |
| `downloads` | The torrents and the server's matches; `p1`'s and `p2`'s titles by their tags' ids once the torrents are in, `p3`'s guess by TMDB's search once both are; the posters once one title is; the guess saved a second after it | The rows in place of the skeleton, the totals, the chips' counts, the speed limits switch; each row's title and poster | Titles found |
| `torrent` | The torrents and the matches; the title by its tag's id, or the search for a guess once both are in; the poster; the guess saved | The page in place of its skeleton; the title, its poster; More's dot when no title is found | Tagged and finished (`p2`); title guessed from its name (`p3`, cold cache); no title found (`p4`) |
| `browse` | Three Discover queries at once; the posters once all three are in | The three rows, together, in place of the skeleton; their posters | Rows of titles |
| `search` | TMDB's search; the posters | The results with their count and Show more, in place of the skeleton; their posters | Titles found |
| `search-year` | TMDB's search for movies and for series, at once; the posters once both are in | The results, together, in place of the skeleton; their posters | Titles found |
| `title` | The details, the torrents and the matches at once; the poster and the recommendations once the details are in, their posters after them; the guess of the untagged torrent's title, since the tagged ones' titles are known without TMDB (#381) | The page in place of its skeleton; the poster; the "In downloads" badge, above the title out of the flow, once the details and the torrents are both in; the recommendations row; the "In downloads" block under it once both it and the torrents are in | A movie in downloads, with recommendations |
| `series` | As `title`; similar titles once the recommendations come back empty | As `title`, with the series hint and similar titles in place of recommendations | A series in downloads, with similar titles |
| `releases` | The series' details; Prowlarr's search; which indexers failed during it | The title and year under the heading; the chips and the releases in place of their skeletons, or the empty state with the chips' row emptied in place; how many indexers didn't answer, in the count's line | Every indexer answered; one indexer didn't answer; nothing found |
| `settings` | Settings' own load of the server's settings, the checks of qBittorrent, Prowlarr and TMDB at once; the categories once qBittorrent's check is in | None: every row is there from the first paint, and the answers change only what the rows say and the category selects' options | Every service answers |

On desktop each screen has the same chain, with what the desktop layout adds or does otherwise:

| Screen | What differs on desktop | Late blocks it adds | Cases |
| --- | --- | --- | --- |
| Every screen | The sidebar's torrents (its downloading count and qBittorrent card read the shared poll) once the server's settings are in; a screen that shows torrents asks for them itself | None: the sidebar's qBittorrent card keeps its room from the first paint, `—` for the speeds and the free space and its switch disabled until the poll answers (#404) | |
| `downloads` | None in the chain. The layout: the grid of cards by default (the list on a phone), the status as a `StatusMenu` in place of the chips, and the table of rows as the other view | The status button's count and the totals' speeds coming in, which move the type filter and the next total sideways; in the table, the rows' names wrapping as the titles come in. The header's tools stay at the row's end and the table is an element of its own, not the loading rows' made over (#405) | Titles found, in the grid; titles found, as a table |
| `torrent` | The drawer over Downloads: the list's lookups three at a time (`p4`'s, among the torrents, once one of the first three is in) and the drawer's own lookup of its torrent, the same address as the list's; the posters and the guess saved once one title is | As `downloads`, under the drawer; in the drawer, as on a phone | Tagged and finished (`p2`); title guessed from its name (`p3`); no title found (`p4`) |
| `title`, `series` | The hero's poster, a larger size | Where the torrents land last, the empty "In downloads" section filling in, drawn a frame late by reduced motion's 1 ms transition (0.0029 in CI, #390). The hero's backdrop fade is an element of its own, not the loading state's head made over, so it moves nothing (#406) | As on a phone |
| `releases` | The series' title page with its releases under the hero, searched as it opens at their address: the title page's answers, and Prowlarr's search and which indexers failed once the details are in | The filter bar's skeleton chips replaced by the filters; the table in place of its skeleton, or the empty state under the bar's room kept, empty | Every indexer answered; one indexer didn't answer; nothing found; and at `desktop-rail` and `desktop-1280`, every indexer answered, where the bar wraps to a second line once the filters land (#400) |

The desktop budgets carry these known jumps, each with its issue, and their fixes lower them:
the narrower sizes' `releases` #400's, the table moving down by the bar's second line (0.0315 at
1024px, 0.0223 at 1280px, in CI).

- **What it leaves out.** Moves between screens by a click: the screens are opened by their address. The app with motion on.
  Empty and "not answering" states but the releases' "nothing found", and the releases' "nothing
  found" with an indexer that didn't answer, whose banner pushes the empty state down (0.029, #401),
  and the other states the screenshot tests open (other
  torrents' pages beside these three, a search that finds nothing, onboarding). The desktop widths
  between those read: each screen at 1440px, the releases also at 1024px and 1280px, where #400's
  bar wraps (at 1024–1099px and about 1162–1340px), so a jump that shows only at another width isn't
  caught. A title the server's matches already hold (the user's choice, or a
  guess another device saved), which is asked for by its id as `p2`'s is. A title's page whose
  torrent is matched by a guess rather than a tag, where "In downloads" comes in with TMDB's search,
  a later answer than either case lands it with (at the page's end, with nothing under it to move). The web font landing after the content: the
  releases then read 0.199 on a Mac and 0.066 on the Playwright Linux image, as the names wrap again
  in the fallback font, so the test has the fonts in before the first answer: what a late font moves
  depends on the machine's fallback font, and a budget on it would be the runner's, not the app's.
  The jump itself is left as it is (decided on 2026-11-13, SPEC's decision log): it can show only on
  the very first open of Kinopeer on a device, and only when that open is the releases by a direct
  link, since Downloads is the usual first screen and after it the service worker keeps the font, so
  a fix isn't worth its code now. It comes back if a real phone shows the jump, or first opens by a
  link become common. The states between the titles' answers in Downloads: the app shows the
  titles that came in a batch every `SHOW_EVERY_MS` (250 ms, `src/torrents/useTitleMatches.ts`), and
  the next title's lookup is asked without waiting for it, so whether two titles show in one frame
  or in two goes by the clock. Today's reading (0.0028 on a Mac, 0.0030 in CI) doesn't depend on
  it; a jump planted in a row reads one of two numbers by how the batches fall, in the order where
  the first asked lands first (#395's review: a 30px block read 0.0507 or 0.0395 there, and 0.0450
  in the other order, all over the budget), so the jump is still caught, but its number may differ
  from run to run. Left so, since the alternative is three more waits in one
  case, one per title, that would have to be kept in step with the app's batching.
