# Testing

How Kinoseed's tests are organized: six layers, each with one job, the shared test data and the
fake services, coverage, and the screenshot tests. Running and releasing are in
[DEVELOPMENT.md](DEVELOPMENT.md); the conventions every PR follows are in [CLAUDE.md](../CLAUDE.md).

```sh
npm test                    # layers 1–4 (Vitest), single run
npm test -- --project app   # only the jsdom tests (src/)
npm test -- --project server  # only the server tests (server/)
npm run test:coverage       # the same with coverage: a table in the terminal, coverage/index.html
npm run test:visual         # layer 6: screenshot tests in Docker
npm run test:visual:update  # re-render their baselines
```

## Layers

| # | Layer | What it checks | What it doesn't | Tool | Where | Run |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pure logic | Parsing release and torrent names, picking a title, filtering and sorting, formatting, the SHA-1 fallback: functions that import no React, DOM or Node APIs | Rendering, the network | Vitest | `*.test.ts` next to the module (`src/releases/`, `src/torrents/`, `src/lib/`, `server/json.ts`) | `npm test` |
| 2 | Components | A shared component renders its props with the right roles and names and reacts to input (`src/components/`) | Layout and looks, which jsdom has none of | Vitest + Testing Library, jsdom | `src/components/*/*.test.tsx` | `npm test` |
| 3 | Screens and flows | A screen or a user flow with the API clients mocked (`vi.mock('../api/…')`): what it shows for a state, what it calls, where it navigates | Real HTTP, the server, layout | Vitest + Testing Library + user-event, jsdom | `src/screens/*.test.tsx`, `src/App.test.tsx`, hooks in `src/session/`, `src/torrents/` | `npm test` |
| 4 | Server | Each middleware under `server/` against fake qBittorrent, TMDB and Prowlarr servers started in the test: routing, headers, what reaches the service and what comes back | Browser code | Vitest, Node (`server` project) | `server/*.test.ts`, fakes in `server/test/fakes.ts` | `npm test -- --project server` |
| 5 | Integration | The real clients in `src/api/*` calling the real `kinoseedServer()` in front of the fakes: both ends of each route agree on paths, bodies and errors | Rendering | Vitest, Node | `server/integration/` (written in a later PR) | `npm test -- --project server` |
| 6 | Screenshots | How the screens look: the built app in Chromium against baseline PNGs, with every server route mocked | Behavior, which the layers above cover faster | Playwright in Docker | `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/` | `npm run test:visual` |

Layers 1–4 run on every `npm test` in two Vitest projects (`vite.config.ts`): `app` is jsdom with
`src/test-setup.ts` (jest-dom matchers, the interface language reset to English, Testing Library's
cleanup, a no-op `window.scrollTo` since jsdom only logs "not implemented" for it); `server` is
plain Node for `server/**/*.test.ts`. Tests sit next to the code as `*.test.ts(x)` and query by
role and accessible name.

## Choosing a layer

Written in a later PR.

## When we find a bug

Written in a later PR.

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
  and records the requests past the login; `fakeTmdb()` answers the API, the authentication check
  and the image host, recording what reached it. A test that needs a service to misbehave in one
  specific way (a 401, a hanging download) writes that handler inline with `listen`.

## Coverage

`npm run test:coverage` runs the Vitest layers with `@vitest/coverage-v8` and prints a table per
file, plus an HTML report in `coverage/` (git-ignored). It measures `src/` and `server/` without the
tests themselves, `src/test/`, `server/test/`, type-only modules and the `index.ts` barrels of
`src/api/*` and `src/components/*`, which only re-export (`vite.config.ts`). CI runs the same in the `check` job, adds the totals to the job summary
(`scripts/coverage-summary.mjs`) and uploads the HTML report as the `coverage` artifact. There is
no threshold: the numbers are there to see what a PR leaves uncovered, not to gate it.

## Lint rules for tests

oxlint runs its `vitest` plugin on the test files (`.oxlintrc.json`): no two tests with the same
title, no `.skip` or `.only` left behind, every test has an `expect`, no test defined inside a
condition.

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
