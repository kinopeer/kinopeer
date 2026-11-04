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
npm run test:coverage  # the same with a coverage report
npm run lint       # linter (oxlint)
npm run typecheck  # type check
npm run build      # production build into dist/
npm start          # production server over dist/
npm run test:visual  # screenshot tests in Docker (docs/TESTING.md)
```

The screenshot tests keep the container's `node_modules` in a Docker volume per checkout, so worktrees can run them at once; a volume goes away by itself once its checkout's folder does ([TESTING.md](TESTING.md) → Screenshot tests).

The dev server has the same routes as production: `/qbt`, `/prowlarr`, `/tmdb`, `/tmdb-img`, `/api/settings`. Run lint, typecheck, test and build before pushing; CI runs the same on every PR (the tests with coverage, whose totals land in the job summary), runs the screenshot tests and builds and smoke-tests the Docker image. `npm run test:mutants` runs locally before a PR is marked ready, and in CI once per PR head ([TESTING.md](TESTING.md) → A test that can fail). The service worker is off in `npm run dev`: try it with `npm run build && npm run preview`.

## Tests

The test layers, the shared fixtures and fakes, coverage and the screenshot tests (incl. the README screenshots) are described in [TESTING.md](TESTING.md).

## Server configuration

The server reads environment variables (from `.env.local` in development). Whatever is entered in the app is saved to `$KINOSEED_DATA_DIR/settings.json` and wins over the environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QBITTORRENT_URL` | none | qBittorrent Web UI address |
| `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | none | Default login; a login entered in the app wins |
| `PROWLARR_URL` | none | Prowlarr address |
| `PROWLARR_API_KEY` | none | Prowlarr API key; a key entered in the app wins |
| `PROWLARR_CONFIG_XML` | none | Path to Prowlarr's `config.xml` to read the key from when neither a key entered in the app nor `PROWLARR_API_KEY` is set (the Umbrel package does this) |
| `TMDB_API_KEY` | none | Fallback TMDB key; a key entered in the app wins |
| `TMDB_API_URL` | `https://api.themoviedb.org/3` | TMDB's API address; the integration and smoke tests point it at a fake |
| `TMDB_IMAGE_URL` | `https://image.tmdb.org/t/p` | TMDB's image address, the same way |
| `KINOSEED_DATA_DIR` | `./data` (`/data` in the image) | Where `settings.json` and `matches.json` are kept |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Where the production server listens |
| `KINOSEED_DIST` | `../dist` | What the production server serves |

## Docker

The image is built from `Dockerfile` (`node:24-alpine`, no `node_modules`). `docker compose up --build` runs it locally at `http://localhost:8080` with settings from `.env.local`. That's for checking the image, not a supported way to install. `/healthz` answers `ok` while the server runs.

## Releasing

First go through [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before every release (the test-gap pile, the suite's health, the checks by hand); the release PR notes what it found.

1. In a PR, set `version` in `package.json` and `package-lock.json` (`npm version 0.2.0 --no-git-tag-version`) and add a `## 0.2.0 - YYYY-MM-DD` section to `CHANGELOG.md`. Update the "as of version" line at the top of `docs/SPEC.md` too.
2. After it merges, tag `main` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The `Release` workflow builds `ghcr.io/mrshakhov/kinoseed` for `linux/amd64` and `linux/arm64` (tags `0.2.0`, `0.2` and `latest`) and creates a GitHub Release with that version's changelog section and the image digest. It fails if the tag doesn't match `package.json` or the changelog has no section for the version.
4. Update the Umbrel package (below).

The image is public, so Umbrel can pull it without a login; the code repository is private for now.

## Umbrel package

The package lives in [umbrel-homelab-store](https://github.com/MrShakhov/umbrel-homelab-store), in `homelab-kinoseed/`. It sets the qBittorrent and Prowlarr addresses and the default qBittorrent login, and mounts Prowlarr's config folder read-only. After a release, bump `version` and `releaseNotes` in `umbrel-app.yml` and the image tag and digest (from the GitHub Release) in `docker-compose.yml`. Umbrel then offers the update.

## Edge builds

Kinoseed Edge is `main` running on the owner's Umbrel next to the released app, so changes get used day to day before a release. The `Edge` workflow (`.github/workflows/edge.yml`) runs on every push to `main` that changes what goes into the image (its `paths` list: the app's and the server's sources without their tests, `public/`, the build config), and only the newest of several pushes in a row is built:

1. It builds `ghcr.io/mrshakhov/kinoseed` for `linux/arm64` only (the Raspberry Pi), tagged `edge` and `sha-<commit>`. The build passes `KINOSEED_COMMIT`, so Settings → About and bug reports show the version with the commit, `0.6.0+abc1234`; release images leave it out.
2. It commits to the edge store, [umbrel-homelab-edge](https://github.com/MrShakhov/umbrel-homelab-edge) (store id `homelab-edge`, app `homelab-edge-kinoseed`, port 8796): the image by tag and digest in `docker-compose.yml`, and in `umbrel-app.yml` that version and the commit subjects since the previous edge build as release notes. It pushes with a deploy key that can write to that repository only, kept in the `EDGE_STORE_DEPLOY_KEY` secret.
3. umbrelOS checks community stores every 5 minutes and offers an update whenever the version differs from the installed one; the owner installs it from the App Store.

Nothing in the edge store is edited by hand. Its package is the released one's with another id, name and port: it keeps its own settings and torrent-to-title matches, and works with the same qBittorrent and Prowlarr, so what it does to torrents is real. The store only moves forward: a run for a commit the store already has (a re-run of an older push) builds nothing and leaves it as it is. When a run's store step failed, re-run it, or run the workflow from the Actions tab (`workflow_dispatch`), which builds main's head and ignores other branches.

## The TMDB proxy

Kinoseed's own TMDB key sits behind a Cloudflare Worker, `tmdb-proxy/worker.ts` (worker `kinoseed-tmdb` on `workers.dev`), for installs that have no key of their own; SPEC's decision log (2026-11-04) says why a key can't ship in the image. The worker takes TMDB's paths under `/3/`, answers only GET and HEAD for the ones `src/api/tmdb/client.ts` calls (404 for the rest), adds the key, keeps TMDB's answers at the edge for an hour (searches) to a day (a title's page), and limits the calls that reach TMDB to 100 per IP in 10 seconds. It keeps no request logs. Its tests run in the `server` Vitest project.

The `TMDB proxy` workflow (`.github/workflows/tmdb-proxy.yml`) deploys it with Wrangler on every push to `main` that changes `tmdb-proxy/`, and when run from the Actions tab. It needs three repository secrets, set in the GitHub web UI: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template), `CLOUDFLARE_ACCOUNT_ID` and `TMDB_API_KEY` (Kinoseed's key, a v3 key or a v4 read access token). The key reaches the worker as its secret, never the code or a log. To replace a leaked or revoked key, change `TMDB_API_KEY` in the repository's secrets and run the workflow: installs keep working without a release.

To try the worker locally, run `npx wrangler@4.151.2 dev` in `tmdb-proxy/` with the key in `tmdb-proxy/.dev.vars` (`TMDB_API_KEY=…`, git-ignored) and call `http://localhost:8787/3/configuration`.

## Design

The canvas with every screen and the design system live in Claude Design (links in CLAUDE.md). Colors, type and spacing come from the design system's tokens. The canvas is a reference as of 0.4.0 and is no longer kept in sync; the app is the reference for screens.
