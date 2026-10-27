# Development

How to run Kinoseed locally, how the server is configured and how a release goes out. The detailed architecture and conventions are in [CLAUDE.md](../CLAUDE.md).

## Requirements

Node.js 22.18+ and qBittorrent with the Web UI on. Release search needs Prowlarr; metadata needs a TMDB key (it can be entered in the app).

## Running

```sh
cp .env.example .env.local   # set QBITTORRENT_URL and PROWLARR_URL
npm install
npm run dev        # http://localhost:5173
npm test           # tests (Vitest)
npm run lint       # linter (oxlint)
npm run typecheck  # type check
npm run build      # production build into dist/
npm start          # production server over dist/
npm run test:visual  # screenshot tests in Docker (below)
```

The dev server has the same routes as production: `/qbt`, `/prowlarr`, `/tmdb`, `/tmdb-img`, `/api/settings`. Run lint, typecheck, test and build before pushing; CI runs the same on every PR, runs the screenshot tests and builds and smoke-tests the Docker image. The service worker is off in `npm run dev`: try it with `npm run build && npm run preview`.

## Screenshot tests

Unit tests run in jsdom, which has no layout, so they can't catch a button in the wrong place or a title that doesn't clamp. Screenshot tests do: Playwright opens the built app (`vite preview`) in Chromium and compares each screen with a baseline PNG.

- **What's covered:** Downloads (list and poster grid, empty, offline, the actions sheet), Search (browse rows and results), the title page (movie and series), Releases (results, the filters sheet, the add sheet and its file picker), torrent details (with files, and an error) and Settings. Mostly a phone in portrait (390×844), dark theme, Russian; some in the light theme in English and on a wide screen (1280×800). Specs are in `e2e/*.spec.ts`, baselines in `e2e/__screenshots__/`.
- **No live services:** `e2e/app.ts` answers `/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api/settings` and `/api/matches` from the fixtures in `e2e/fixtures.ts`, matched by URL pathname (a glob like `**/tmdb/**` would also catch Vite's `/src/api/tmdb/` modules). Posters are generated gradients and the release's `.torrent` is built there too. The app version in Settings is masked, so a version bump doesn't change the screenshots. The clock is frozen, animations are off and the service worker is blocked.
- **Docker only:** fonts render differently on macOS and on other Linux setups (about 1% of pixels, enough to fail), so baselines are rendered only in the Playwright image. `npm run test:visual` runs the tests in it with Docker; `node_modules` for the container is kept in a Docker volume, not the host's. Arguments go to `playwright test`, e.g. `npm run test:visual -- e2e/search.spec.ts`.
- **Changing the UI:** a PR that changes how a covered screen looks updates its baselines. First run `npm run test:visual` as is: every failed screenshot leaves an expected, an actual and a diff image in `test-results/`, where the diff highlights only the changed pixels. Make sure nothing but the intended change is highlighted, then re-render with `npm run test:visual:update` and commit the PNGs (GitHub shows image diffs in the PR too). Say in the PR which screens changed and why. Add a spec when a new screen or state needs one.
- **In CI:** the `visual` job runs in the same image. When it fails, its `playwright-report` artifact has the expected, actual and diff images.
- **Upgrading Playwright:** `@playwright/test` in `package.json`, the image tag in `scripts/test-visual.sh`, `scripts/readme-screenshots.sh` and `.github/workflows/ci.yml` must name the same version; re-render the baselines after an upgrade.

### README screenshots

`npm run screenshots:readme` re-renders the screenshots in `docs/screenshots/` (`e2e/readme.shots.ts`, config `playwright.readme.config.ts`): four phone screens and two desktop ones, dark theme, Russian. It runs in the same Playwright image, but on the dev server, so titles and posters come from TMDB for real; qBittorrent and Prowlarr answer from the fixtures. Only `TMDB_API_KEY` goes into the container, from the environment or `.env.local`. Retake them when a screen in the README changes noticeably, check the PNGs and commit them; nothing compares them in CI.

## Server configuration

The server reads environment variables (from `.env.local` in development). Whatever is entered in the app is saved to `$KINOSEED_DATA_DIR/settings.json` and wins over the environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QBITTORRENT_URL` | none | qBittorrent Web UI address |
| `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | none | Default login; a login entered in the app wins |
| `PROWLARR_URL` | none | Prowlarr address |
| `PROWLARR_API_KEY` | none | Prowlarr API key |
| `PROWLARR_CONFIG_XML` | none | Path to Prowlarr's `config.xml` to read the key from when `PROWLARR_API_KEY` is not set (the Umbrel package does this) |
| `TMDB_API_KEY` | none | Fallback TMDB key; a key entered in the app wins |
| `KINOSEED_DATA_DIR` | `./data` (`/data` in the image) | Where `settings.json` and `matches.json` are kept |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Where the production server listens |
| `KINOSEED_DIST` | `../dist` | What the production server serves |

## Docker

The image is built from `Dockerfile` (`node:24-alpine`, no `node_modules`). `docker compose up --build` runs it locally at `http://localhost:8080` with settings from `.env.local`. That's for checking the image, not a supported way to install. `/healthz` answers `ok` while the server runs.

## Releasing

1. In a PR, set `version` in `package.json` and `package-lock.json` (`npm version 0.2.0 --no-git-tag-version`) and add a `## 0.2.0 - YYYY-MM-DD` section to `CHANGELOG.md`. Update the "as of version" line at the top of `docs/SPEC.md` too.
2. After it merges, tag `main` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The `Release` workflow builds `ghcr.io/mrshakhov/kinoseed` for `linux/amd64` and `linux/arm64` (tags `0.2.0`, `0.2` and `latest`) and creates a GitHub Release with that version's changelog section and the image digest. It fails if the tag doesn't match `package.json` or the changelog has no section for the version.
4. Update the Umbrel package (below).

The image is public, so Umbrel can pull it without a login; the code repository is private for now.

## Umbrel package

The package lives in [umbrel-homelab-store](https://github.com/MrShakhov/umbrel-homelab-store), in `homelab-kinoseed/`. It sets the qBittorrent and Prowlarr addresses and the default qBittorrent login, and mounts Prowlarr's config folder read-only. After a release, bump `version` and `releaseNotes` in `umbrel-app.yml` and the image tag and digest (from the GitHub Release) in `docker-compose.yml`. Umbrel then offers the update.

## Design

The canvas with every screen and the design system live in Claude Design (links in CLAUDE.md). Colors, type and spacing come from the design system's tokens. The canvas is a reference as of 0.4.0 and is no longer kept in sync; the app is the reference for screens.
