# Testing

How Kinoseed's tests are organized: six layers, each with one job, and how to choose one; what to
do with a bug; what no layer sees; the shared test data and the fake services; coverage and its
threshold; the screenshot tests and the smoke journeys. Running and releasing are in
[DEVELOPMENT.md](DEVELOPMENT.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

```sh
npm test                    # layers 1–5 (Vitest), single run
npm test -- --project app   # only the jsdom tests (src/)
npm test -- --project server  # only the server and integration tests (server/)
npm run test:coverage       # the same with coverage and its threshold: a table in the terminal, coverage/index.html
npm run test:visual         # layer 6: screenshot tests in Docker
npm run test:visual:update  # re-render their baselines
npm run test:smoke          # layer 6: smoke journeys through the production server, no Docker
```

## Layers

| # | Layer | What it checks | What it doesn't | Tool | Where | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pure logic | Parsing release and torrent names, picking a title, filtering and sorting, formatting, the SHA-1 fallback: functions that import no React, DOM or Node APIs | Rendering, the network | Vitest | `*.test.ts` next to the module (`src/releases/`, `src/torrents/`, `src/lib/`, `server/json.ts`) | `npm test` |
| 2 | Components | A shared component renders its props with the right roles and names and reacts to input (`src/components/`) | Layout and looks, which jsdom has none of | Vitest + Testing Library, jsdom | `src/components/*/*.test.tsx` | `npm test` |
| 3 | Screens and flows | A screen or a user flow with the API clients mocked (`vi.mock('../api/…')`): what it shows for a state, what it calls, where it navigates | Real HTTP, the server, layout | Vitest + Testing Library + user-event, jsdom | `src/screens/*.test.tsx`, `src/App.test.tsx`, hooks in `src/session/`, `src/torrents/` | `npm test` |
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

## Choosing a layer

One behavior, one layer: every statement about what Kinoseed does lives in exactly one test, on the
lowest layer that can see it. Higher layers meet that behavior only as a step towards the state they
check: a screen test opens the sort sheet to reach a sorted list and doesn't re-check the order's
rules, which `sort.test.ts` owns. Pick the layer by what the statement needs:

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
- **Roles and names, not classes.** Tests find elements by role and accessible name
  (`getByRole('button', { name: 'Удалить' })`), so a test fails when the behavior changes, not when
  a stylesheet does. The one place a class is the point is a layer-2 test of a design-system
  component (`Button`, `IconButton`, `Dialog`): their classes are the contract with their CSS, so
  `toHaveClass('ks-btn-primary')` is what such a test is about. Nowhere else.
- **Helpers and fixtures.** Data every layer shares is in `src/test/fixtures.ts`, the rendering
  helpers in `src/test/render.tsx`, the fake services in `server/test/fakes.ts`
  ([Shared test data](#shared-test-data)). What one file uses stays in that file; the second copy of
  a literal or a helper moves it to the shared place, as `DUNE_TORRENT` did. A service's new
  behavior is an addition to its fake, with a comment on what the real service does and in which
  version; an inline server is only for a test that needs the service to misbehave in one specific
  way. `vi.mock` stays in each test file on purpose, so a reader sees what the test replaces without
  opening another module.
- **A flaky test is fixed or deleted.** Not retried, not skipped, not marked `fixme`: a retry hides
  the instability and a skip hides the behavior (oxlint refuses `.skip` and `.only`). Both Playwright
  configs run with `retries: 0`, so a screenshot or a journey that fails once fails the job.

### Saying why something is uncovered

A change without a test says so in the PR's Tests section, with the reason, and the reason is one
of these:

- **Looks and layout:** CSS, spacing, a token; checked on the test stand or by a screenshot
  baseline, and the PR says which.
- **A blind spot:** only a real phone, Umbrel's proxy, a real service version or real time shows
  it ([Known blind spots](#known-blind-spots)); the PR names the spot and, when the checklist has a
  manual check for it, that it was done.
- **Covered already:** a refactor or a move that an existing test still asserts; the PR names that
  test by its `it` title, and the reviewer opens it.
- **No behavior:** docs, comments, CI and config, types, generated files, a re-export.

"Trivial", "later", "tested manually" without saying what and where, or a reason that doesn't fit
the diff are not reasons: the change gets its test or the PR explains itself better. The review
(`/test-review`, [Reviewing a PR's tests](#reviewing-a-prs-tests)) reads this section first and
checks the reasons before it looks for missing tests.

## When we find a bug

A bug is two defects: one in the code and one in the tests that let it through. A `fix/` PR answers
three questions: why it broke, why the tests didn't catch it, and what changes so this class of miss
is caught from now on. The order of work:

1. **An issue first.** A bug from the test stand, from Umbrel or from a test under construction
   becomes an issue with the steps and the environment (phone or desktop, HTTP or HTTPS, the
   qBittorrent version, where it was found) before anyone fixes it, so the fix can be checked against
   what was seen and the label below has a place to live.
2. **A red test on the lowest layer that sees it** (the table above), run to watch it fail on `main`.
3. **The fix**, and the test goes green with everything else.
4. **The record** in the PR and on the issue, below.

The test lives where an ordinary test of that behavior would: next to the code, on its layer, named
after the behavior ("stays open when Escape cancels its delete confirmation"). No `regressions/`
folder and no "issue 123" in a test's name; a link to the issue in a comment only where the case
isn't obvious from the name and the code.

**Why the tests missed it** is one of six classes. Each has a label (`test-gap:<class>`) and an
action besides the test itself:

| Class | What it looks like in Kinoseed | What we do besides the test |
| --- | --- | --- |
| `uncovered` | Nobody sent `cancel` to a confirmation nested in the drawer (#107) | Add the test. A whole module or family of states without tests gets covered, not just the one case |
| `wrong-layer` | A jsdom test asserted that the filter bar "stays at the top", which jsdom can't see | Move the statement to the layer that sees it (a screenshot after a scroll) and delete the old test |
| `implementation` | A screen test's mock answered what the server never sends, so the screen passed against a fiction | Rewrite the test to the behavior the user sees; the contract between client and server goes to layer 5 |
| `fake-drift` | qBittorrent 5.3 answers 401 to a wrong password; the fake still answered `200 "Fails."` | Fix the fake, with a comment on the real behavior and the version it was seen in, and run everything on the fixed fake |
| `environment` | No `crypto.subtle` over plain HTTP; Umbrel's app_proxy wants a cookie on every fetch; the service worker served the old shell | Add the environment to layer 5 or 6 when it's cheap (the smoke stand's proxy is one); otherwise a line in [Known blind spots](#known-blind-spots) and a manual check in `RELEASE_CHECKLIST.md` |
| `silent-test` | A test without an `expect`, a `.skip`, a screenshot that passes on retry | Fix or delete the test; where oxlint can catch the shape, a rule in `.oxlintrc.json` |

The record: a **Why tests missed it** section in the PR (the template has it) with the class and
what changes so the class is caught, and the `test-gap:<class>` label on the issue. A systemic
finding (a blind spot, a fake that had drifted) also becomes a line in this file, in the same PR.
There is no separate log: the closed issues with these labels are the history.

Once per release, look at the pile ([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before every
release): three bugs of one class since the last release are a problem of the system, not three
accidents. Three `fake-drift` → compare the fakes with the live services on Umbrel by hand; three
`wrong-layer` → the layer rule above reads badly, rewrite it; three `uncovered` in one area → that
area gets a pass over its states, not three more tests; three `environment` → that environment goes
into layer 6; three `implementation` → review the mocks in that area; three `silent-test` → a lint
rule.

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
| A real phone: Safari on iOS, installing the PWA from Share → Add to Home Screen, the standalone window | Chromium at 390×844 in Docker | By hand on the owner's phone against `dev-lan` for a PR that changes a phone screen, and the checklist's phone pass before a release |
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
  shows the current path, which `where()` reads back. API mocks stay in each test file (`vi.mock`,
  hoisted), so a reader sees what the test replaces without opening another module.
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
  status check, a search with the fixtures' releases (their download links carry the key, as
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
and a guess against the user's choice in the matches. To add a contract, call the client, then
check what the fake saw (`qbittorrent.seen`, `prowlarr.seen`, `tmdb.seen`), what the server
answered and what it saved; a service's new behavior goes into its fake, not inline. The tests
wait for nothing real: `addRelease` gets a `wait` that resolves at once, and the fakes answer at
once. They are typechecked by `tsconfig.integration.json`, with the bundler's module resolution,
since the clients import without file extensions; the rest of `server/` stays under
`tsconfig.node.json`, which checks the `.ts` imports Node needs.

## Coverage

`npm run test:coverage` runs the Vitest layers with `@vitest/coverage-v8` and prints a table per
file, plus an HTML report in `coverage/` (git-ignored). It measures `src/` and `server/` without the
tests themselves, `src/test/`, `server/test/`, type-only modules and the `index.ts` barrels of
`src/api/*` and `src/components/*`, which only re-export (`vite.config.ts`). CI runs the same in the
`check` job, adds the totals to the job summary (`scripts/coverage-summary.mjs`) and uploads the HTML
report as the `coverage` artifact.

The run fails under a threshold (`coverage.thresholds` in `vite.config.ts`): 94% of lines, 92% of
statements, 91% of functions and 90% of branches, each two points under the totals of 2026-10-27
(96.8, 94.7, 93.9 and 92.1), rounded down. The threshold is a ratchet: when the totals have grown and
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

Before a PR merges, its tests are reviewed against this file with the `test-review` skill
(`.claude/skills/test-review/SKILL.md`): `/test-review <PR number>` in a Claude Code session, or
`/test-review` for the current branch. It reads the PR's description first (the Tests section's
layers, what is declared uncovered and why, the changed baselines, a fix's "Why tests missed it"),
then checks the diff: every change covered or explained with an accepted reason, nothing lost when
a test is deleted, each assertion on its layer, behavior rather than implementation, fakes true to
the services, no sleeps or forced clicks, baselines listed, docs matching the code, the threshold
not lowered. It reports findings with the rule each breaks and a verdict. It doesn't look for bugs
in the code (`/code-review` does) and doesn't run the suite (CI does). A reviewer without the skill
goes through the same list by hand; the skill is the list.

## Screenshot tests

Unit tests run in jsdom, which has no layout, so they can't catch a button in the wrong place or a title that doesn't clamp. Screenshot tests do: Playwright opens the built app (`vite preview`) in Chromium and compares each screen with a baseline PNG.

- **What's covered:** what only the browser sees, one baseline per layout or state, in the dark theme and Russian unless said otherwise. Specs are in `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`.
  - A phone (390×844): Downloads (list and poster grid, the sort and filter sheet, the actions sheet, selection, empty, offline, the sticky filter bar after a scroll), Search (browse rows and results), the title page (movie and series), Releases (results, the filters sheet, the add sheet and its file picker), torrent details (with files, a guessed title, changing the title, an error), Settings (and a connection with an error) and the connect screen with a wrong password.
  - A tablet (768×1024): Downloads in the centered column, with the tab bar over it.
  - Desktop (1440×900): the sidebar with labels, Downloads as a grid and as a table (the row and sort menus, selection, offline, the sticky header and column names after a scroll), Search (incl. no results), the title page (incl. the long overview with Show more), releases under the hero with a filter popover, the torrent drawer over Downloads and over the title page, the add and delete modals, Settings and onboarding. The icon rail (1024×768) in the status menu, releases and Settings; the labelled sidebar at its narrowest (1100×800) and full HD (1920×1080) for the table's columns.
  - The light theme in English twice, where its colors show on every status and on the sidebar: the Downloads list on the phone and the grid on desktop.
  - A behavioral `expect` in a spec only gets a screen to its state, or checks what jsdom can't see (where a click lands, sticky positioning, a container query, a real `<dialog>`); behavior itself is layers 1–4.
- **No live services:** `e2e/app.ts` answers `/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api/settings` and `/api/matches` from the shared fixtures (`src/test/fixtures.ts` through `e2e/fixtures.ts`), matched by URL pathname (a glob like `**/tmdb/**` would also catch Vite's `/src/api/tmdb/` modules). Posters are generated gradients and the release's `.torrent` is built from the fixtures too. The app version in Settings is masked, so a version bump doesn't change the screenshots. The clock is frozen, animations are off and the service worker is blocked.
- **Docker only:** fonts render differently on macOS and on other Linux setups (about 1% of pixels, enough to fail), so baselines are rendered only in the Playwright image. `npm run test:visual` runs the tests in it with Docker; `node_modules` for the container is kept in a Docker volume, not the host's. Arguments go to `playwright test`, e.g. `npm run test:visual -- e2e/search.spec.ts`.
- **Changing the UI:** a PR that changes how a covered screen looks updates its baselines. First run `npm run test:visual` as is: every failed screenshot leaves an expected, an actual and a diff image in `test-results/`, where the diff highlights only the changed pixels. Make sure nothing but the intended change is highlighted, then re-render with `npm run test:visual:update` and commit the PNGs (GitHub shows image diffs in the PR too). Say in the PR which screens changed and why. Add a spec when a new screen or state needs one.
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
