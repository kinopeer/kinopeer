# Development

How to run Kinopeer locally, how the server is configured and how a release goes out. The detailed architecture and conventions are in [CLAUDE.md](../CLAUDE.md).

## Requirements

Node.js 22.18+ and qBittorrent with the Web UI on. Release search needs Prowlarr. Metadata comes from TMDB through Kinopeer's TMDB proxy without a key of your own; the dev server uses its edge worker (The TMDB proxy, below), and a key in `.env.local` or entered in the app goes to TMDB directly.

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

The dev server has the same routes as production: `/qbt`, `/prowlarr`, `/tmdb`, `/tmdb-img`, `/api/settings`. Run lint, typecheck, test and build before pushing; CI runs the same on every PR (the tests with coverage, whose totals land in the job summary), runs the screenshot tests and builds and smoke-tests the Docker image. `npm run test:mutants` runs locally before a PR is marked ready, and in CI on every push to a ready PR's head, cancelling a run for an older one ([TESTING.md](TESTING.md) → A test that can fail). The service worker is off in `npm run dev`: try it with `npm run build && npm run preview`.

## Tests

The test layers, the shared fixtures and fakes, coverage and the screenshot tests (incl. the README screenshots) are described in [TESTING.md](TESTING.md).

## Server configuration

The server reads environment variables (from `.env.local` in development). Whatever is entered in the app is saved to `$KINOPEER_DATA_DIR/settings.json` and wins over the environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QBITTORRENT_URL` | none | qBittorrent Web UI address |
| `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | none | Default login; a login entered in the app wins |
| `PROWLARR_URL` | none | Prowlarr address |
| `PROWLARR_API_KEY` | none | Prowlarr API key; a key entered in the app wins |
| `PROWLARR_CONFIG_XML` | none | Path to Prowlarr's `config.xml` to read the key from when neither a key entered in the app nor `PROWLARR_API_KEY` is set (the Umbrel package does this) |
| `TMDB_API_KEY` | none | Fallback TMDB key; a key entered in the app wins |
| `TMDB_PROXY_URL` | the release worker, `https://tmdb.kinopeer.com/3` (edge images and the dev server: the edge worker, from `KINOPEER_TMDB_PROXY`) | Kinopeer's TMDB proxy for calls without a key (The TMDB proxy, below); empty turns it off, and the app asks for a key. The integration and smoke tests set it empty or to the worker in front of their fake. `tmdb.kinopeer.com` exists only once the first release after the rename has deployed it, so until then a build from `main` run outside Edge (`docker compose`, `npm start`) needs `TMDB_PROXY_URL=https://tmdb-edge.kinopeer.com/3` or a key of its own |
| `TMDB_API_URL` | `https://api.themoviedb.org/3` | TMDB's API address; the integration and smoke tests point it at a fake |
| `TMDB_IMAGE_URL` | `https://image.tmdb.org/t/p` | TMDB's image address, the same way |
| `KINOPEER_DATA_DIR` | `./data` (`/data` in the image) | Where `settings.json` and `matches.json` are kept |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Where the production server listens |
| `KINOPEER_DIST` | `../dist` | What the production server serves |

## Docker

The image is built from `Dockerfile` (`node:24-alpine`, no `node_modules`). `docker compose up --build` runs it locally at `http://localhost:8080` with settings from `.env.local`. Since the rename to Kinopeer its data volume is `kinopeer-data` and its port variable `KINOPEER_PORT`; a compose setup from before keeps its saved settings and matches in the old volume. Compose prefixes a volume with the project, the checkout's folder name by default: after one `docker compose up`, `docker volume ls --filter name=-data` shows both, `<project>_kinoseed-data` and `<project>_kinopeer-data`, and one run copies the old into the new: `docker run --rm -v <project>_kinoseed-data:/from -v <project>_kinopeer-data:/to alpine cp -a /from/. /to/`. That's for checking the image, not a supported way to install. `/healthz` answers `ok` while the server runs.

## Releasing

First go through [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → Before every release (the test-gap pile, the suite's health, the checks by hand); the release PR notes what it found.

1. In a PR, set `version` in `package.json` and `package-lock.json` (`npm version 0.2.0 --no-git-tag-version`) and add a `## 0.2.0 - YYYY-MM-DD` section to `CHANGELOG.md`. Update the "as of version" line at the top of `docs/SPEC.md` too.
2. After it merges, tag `main` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The `Release` workflow builds `ghcr.io/kinopeer/kinopeer` for `linux/amd64` and `linux/arm64` (tags `0.2.0`, `0.2` and `latest`) and creates a GitHub Release with that version's changelog section and the image digest. Then it deploys the `kinopeer-tmdb` worker from the tag (The TMDB proxy, below). It fails if the tag doesn't match `package.json` or the changelog has no section for the version.
4. Wait for the `Release` workflow's `proxy` job to pass and for `https://tmdb.kinopeer.com/3/configuration` to answer 200 (the release image calls that worker, and nothing before the tag tries it but a build from `main` run outside Edge, as `TMDB_PROXY_URL` above says: Kinopeer Edge calls the edge worker). Then update the Umbrel package (below).

The image is public, so Umbrel can pull it without a login; the code repository is private for now.

## Umbrel package

The package lives in [umbrel-homelab-store](https://github.com/MrShakhov/umbrel-homelab-store), in `homelab-kinopeer/`. It sets the qBittorrent and Prowlarr addresses and the default qBittorrent login, and mounts Prowlarr's config folder read-only. After a release, bump `version` and `releaseNotes` in `umbrel-app.yml` and the image tag and digest (from the GitHub Release) in `docker-compose.yml`. Umbrel then offers the update. The package's `icon.svg`, and the edge store's `homelab-edge-kinopeer/icon.svg`, are copies of `scripts/icons/icon.svg`: when the icon changes, both stores get the new copy.

## Edge builds

Kinopeer Edge is `main` running on the owner's Umbrel next to the released app, so changes get used day to day before a release. The `Edge` workflow (`.github/workflows/edge.yml`) runs on every push to `main` that changes what goes into the image (its `paths` list: the app's and the server's sources without their tests, `public/`, the build config), and only the newest of several pushes in a row is built:

1. It deploys the `kinopeer-tmdb-edge` worker from that commit (The TMDB proxy, below).
2. It builds `ghcr.io/kinopeer/kinopeer` for `linux/arm64` only (the Raspberry Pi), tagged `edge` and `sha-<commit>`. The build passes `KINOPEER_COMMIT`, so Settings → About and bug reports show the version with the commit, `0.6.0+abc1234`; release images leave it out.
3. It commits to the edge store, [umbrel-homelab-edge](https://github.com/MrShakhov/umbrel-homelab-edge) (store id `homelab-edge`, app `homelab-edge-kinopeer`, port 8798): the image by tag and digest in `docker-compose.yml`, and in `umbrel-app.yml` that version and the commit subjects since the previous edge build as release notes. It pushes with a deploy key that can write to that repository only, kept in the `EDGE_STORE_DEPLOY_KEY` secret.
4. umbrelOS checks community stores every 5 minutes and offers an update whenever the version differs from the installed one; the owner installs it from the App Store.

Nothing in the edge store is edited by hand. Its package is the released one's with another id, name and port: it keeps its own settings and torrent-to-title matches, and works with the same qBittorrent and Prowlarr, so what it does to torrents is real. The store only moves forward: a run for a commit the store already has (a re-run of an older push) builds nothing and leaves it as it is. When a run's store step failed, re-run it, or run the workflow from the Actions tab (`workflow_dispatch`), which builds main's head and ignores other branches.

## The TMDB proxy

Kinopeer's own TMDB key sits behind a Cloudflare Worker, `tmdb-proxy/worker.ts`, for installs that have no key of their own; SPEC's decision log (2026-11-04) says why a key can't ship in the image. The worker takes TMDB's paths under `/3/`, answers only GET and HEAD for the ones `src/api/tmdb/client.ts` calls (404 for the rest), adds the key, and limits the calls that reach TMDB to 100 per IP in 10 seconds. That limit is soft: Workers' rate limiting counts in each instance and syncs in the background, and on the deployed worker 500 calls at 20 a second from one IP all went through (2026-11-04). What bounds a script is the path list, the cache and the Free plan's daily cap; a strict limit is decided before the public release (`RELEASE_CHECKLIST.md`). Workers Cache, in front of the worker, keeps TMDB's answers for an hour (searches) to a day (a title's page) by the `s-maxage` the worker sets, and runs the worker only on a miss; the older Cache API (`caches.default`) does nothing on `workers.dev`. The cache is shared across the worker's versions (`cross_version_cache`), since every edge build deploys one: a change to what an answer looks like reaches the answers already kept within their time, a day at most. The worker can't be told to empty its cache from outside (Workers Cache is purged only from inside a worker, `ctx.cache.purge`, and this one has no route for it), so to get rid of a bad answer sooner, deploy with `cross_version_cache` set to `false`, which puts the version back in the key, and leave it off for a day: switched back on sooner, the answers kept without the version are served again while within their time. Errors, the worker's own refusals (a 429 included) and HEAD answers are `no-store`. It keeps no request logs. Its tests run in the `server` Vitest project.

Both workers run on Cloudflare's Free plan, which allows 100,000 requests a day for the whole account, cache hits included (a hit doesn't run the worker or meet its limit, but it counts). Over that, the workers answer with an error until midnight UTC, so every install without a key of its own loses TMDB for the rest of the day; installs with their own key don't notice. Cloudflare's dashboard shows the daily count per worker. What to do before the public release is in `RELEASE_CHECKLIST.md`.

It runs as two workers, the environments in `tmdb-proxy/wrangler.jsonc`, each going out with the builds that call it:

| Worker | Address | Called by | Deployed by |
| --- | --- | --- | --- |
| `kinopeer-tmdb-edge` | `https://tmdb-edge.kinopeer.com` | Kinopeer Edge | the `Edge` workflow, before the edge image, on every run that builds one (its `paths` include `tmdb-proxy/`) |
| `kinopeer-tmdb` | `https://tmdb.kinopeer.com` | released versions | the `Release` workflow, after the image and the GitHub Release |

Both addresses are Workers Custom Domains: a worker's first deploy with one creates its DNS record and certificate, which needs `kinopeer.com` in the same Cloudflare account as the workers and a token that can edit Workers routes on that zone. Neither worker is on `workers.dev`, so the address released versions call doesn't change with the Cloudflare account's name. The edge worker was on `kinopeer-tmdb-edge.kinoseed.workers.dev` until the domain was bought (#259); nothing released called it there.

Kinoseed's workers from before the rename, `kinoseed-tmdb` and `kinoseed-tmdb-edge` on `kinoseed.workers.dev`, were deleted on 2026-11-06 (SPEC's decision log), so Kinoseed up to 0.7 has TMDB only with a key of its user's own.

Both call `.github/workflows/tmdb-proxy.yml`, which has no trigger of its own, so a change to when Edge or Release runs changes when its worker goes out too. It deploys only when the proxy's code (`tmdb-proxy/` without its tests) is the same as at main's head or the highest version tag, a release above its prereleases, so a re-run of an older push or tag leaves the worker as it is, while a run isn't skipped because main moved on with a change Edge doesn't build; `tmdb-proxy/deployCheck.ts` decides, with its tests. Wrangler comes from `tmdb-proxy/package-lock.json` (`npm ci` in that folder), and the Cloudflare token is only in the steps that call Cloudflare, not while npm installs it. A change to `tmdb-proxy/` alone also builds an edge image, since Kinopeer Edge is a commit of `main` with its worker.

The workers' paths are a contract with every released version: a path is only added, never removed or changed in what it answers, while a supported version calls it. Changing the cache times, the limit or the key is fine. A change that breaks it (a path dropped, another answer, a check old versions don't pass) goes into a new worker, `kinopeer-tmdb-v2`, that the release with the change calls, while the old one keeps serving the versions before it; it's removed once Cloudflare's request counts show no calls for a month (Umbrel doesn't update apps by itself, so old versions stay). The `lets %s through` test in `tmdb-proxy/worker.test.ts` lists the paths and fails when one goes.

Deploying needs three repository secrets, set in the GitHub web UI: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template), `CLOUDFLARE_ACCOUNT_ID` and `TMDB_API_KEY` (Kinopeer's key, a v3 key or a v4 read access token). Without them the proxy job fails, and the edge image waits for it. The key reaches each worker as its secret, never the code or a log. To replace a leaked or revoked key, change `TMDB_API_KEY` in the repository's secrets and run the `TMDB proxy key` workflow from the Actions tab (`.github/workflows/tmdb-proxy-key.yml`), which puts it into both workers without a deploy: installs keep working without a release.

To try the worker locally, run `npm ci` and then `npx wrangler dev` in `tmdb-proxy/`, with the key in `tmdb-proxy/.dev.vars` (`TMDB_API_KEY=…`, git-ignored), and call `http://localhost:8787/3/configuration`. The top level of `wrangler.jsonc` is `kinopeer-tmdb-local`, so a deploy without `--env` makes a worker nobody calls instead of replacing the release one.

## Design

The canvas with every screen and the design system live in Claude Design (links in CLAUDE.md). Colors, type and spacing come from the design system's tokens. The canvas is a reference as of 0.4.0 and is no longer kept in sync; the app is the reference for screens.
