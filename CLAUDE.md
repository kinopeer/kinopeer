# Kinoseed

A qBittorrent web UI built around movies and TV series. Find a title in TMDB, pick a release via Prowlarr/Jackett, send it to qBittorrent, and manage downloads. No playback. Mobile-first PWA with a desktop layout.

## Stack

- Vite + React 19 + TypeScript (strict), Node.js 22.18+
- oxlint for linting
- Vitest + Testing Library (jsdom) for tests
- GitHub Actions CI: lint, typecheck, test, build on every PR and on push to `main`

## Commands

```sh
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest, single run
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # production build into dist/
npm start          # production server (server/main.ts) serving dist/
```

Run lint, typecheck, test and build before pushing. CI must be green before merge.

## Architecture

- The browser talks to qBittorrent and Prowlarr only through same-origin routes. `/qbt/api/*` → qBittorrent Web API, served by `server/qbittorrent.ts` (Vite middleware in dev using `QBITTORRENT_URL` from `.env.local`, and the production server). With `QBITTORRENT_USERNAME`/`QBITTORRENT_PASSWORD` set, the server logs in itself, keeps the session and re-logs in on a 403, so the app never shows its login form; without them the browser's own session cookie is passed through. Never call those services cross-origin.
- TMDB goes through `/tmdb/*` → `https://api.themoviedb.org/3/*` (`server/tmdb.ts` adds the key, so it never reaches the browser) and images through `/tmdb-img/*` → `https://image.tmdb.org/t/p/*`. Client: `src/api/tmdb/`.
- Server-side settings: `server/settings.ts` keeps what the user enters in the app (for now the TMDB key) in `$KINOSEED_DATA_DIR/settings.json` (default `./data`, git-ignored; `/data` volume in Docker). `GET /api/settings` says only whether each secret is set and where it comes from; `PUT /api/settings/tmdb` checks the key with TMDB, then saves it. A saved key wins over `TMDB_API_KEY`. Client: `src/api/settings/`. Onboarding asks for the key after qBittorrent connects (`src/session/useTmdbSetup.ts`, `src/screens/TmdbKeyScreen.tsx`); Settings → Connections changes it.
- Releases come from Prowlarr through `/prowlarr/*`, served by `server/prowlarr.ts` (Vite middleware in dev, and the production server), not a plain proxy: it adds `PROWLARR_API_KEY` and strips it from results, because Prowlarr's download links carry the key. `/prowlarr/search` returns `Release[]`; `/prowlarr/download?token=` returns the `.torrent` or `{ magnet }`; `/prowlarr/status` returns `{ version, indexers }` for the Settings connection check. Client: `src/api/prowlarr/`. Server code under `server/` runs in Node; its tests run in the `server` Vitest project (no jsdom).
- qBittorrent Web API client: `src/api/qbittorrent/` (incl. adding torrents, file lists and priorities). `.torrent` files and magnet links are read in the browser (`src/torrents/torrentFile.ts`, `magnet.ts`) to get the info hash and files before adding. Session state: `src/session/useQbitSession.ts` checks `app/version` first, so qBittorrent's auth bypass (localhost or whitelisted subnets) goes straight in without a login form.
- Adding a release (`src/screens/AddReleaseSheet.tsx`, `FilePicker.tsx`): Kinoseed gets only the `.torrent` (preferred, so files can be picked) or magnet link from Prowlarr, then adds it to qBittorrent itself via `src/releases/addRelease.ts` with the `tmdb:<type>:<id>` tag, category, save path and options. Prowlarr's own download clients are not used. Skipped files: the torrent is added stopped, those files get priority 0, then it starts. After adding, the app goes to `/` with `{ added: title }` in the location state for a toast.
- Torrent state: `src/torrents/useMainData.ts` polls `sync/maindata` every 2 s (only while the tab is visible, and right away when the device comes back online) and merges the incremental deltas. When qBittorrent stops answering, screens keep the last state under `OfflineBanner` (its age, actions disabled) or show an unreachable state before the first answer; `src/screens/ErrorBoundary.tsx` shows a crash screen with Reload instead of a blank page; `src/torrents/status.ts` maps qBittorrent states to the design's statuses. Sizes, speeds and ETAs go through `src/lib/format.ts`.
- Routing: React Router (`react-router`). `App.tsx` routes `/` (downloads), `/search`, `/title/:type/:id` (type is `movie` or `tv`, id is the TMDB id), `/title/:type/:id/releases` (Prowlarr results with quality filters; `src/releases/parseRelease.ts` reads resolution, source, HDR, voice-over and seasons from release names; searches don't filter by category, because some indexers such as RuTor file every release under "Other") and `/settings` behind the tab bar; `server/static.ts` falls back to `index.html` for these paths. Search state (`q`, `type`) lives in the URL.
- Download rows show the TMDB title and poster: `src/torrents/titleMatches.ts` uses a `tmdb:<movie|tv>:<id>` torrent tag when present (Kinoseed will add it when sending a release), otherwise guesses from the release name (`parseName.ts`) and searches TMDB. Matches are cached in localStorage.
- Per-browser preferences (default categories per type, start paused, sequential, TMDB language) live in `src/settings/settings.ts` (localStorage, `useSettings`, `useTmdbLanguage`). Connection settings stay on the server: service addresses in its environment, the TMDB key in its settings file.
- PWA: `vite-plugin-pwa` builds the manifest (in `vite.config.ts`) and the service worker from `src/sw.ts` (injectManifest, own tsconfig `tsconfig.sw.json`). It precaches the app shell, serves `index.html` for app routes, caches `/tmdb-img/*` posters and never caches `/qbt`, `/prowlarr` or `/tmdb`. A new version activates right away (no lazy chunks, so open pages keep working). The service worker is off in `npm run dev`; try it with `npm run build && npm run preview`. Icons: SVG sources in `scripts/icons/`, PNGs rendered by `scripts/render-icons.mjs`. Service workers need HTTPS (or localhost). Push notifications are deferred.
- Production: `server/main.ts` is a dependency-free Node server (run as `.ts` through Node's type stripping, so server code must stay erasable TypeScript with `.ts` import paths) that chains the `server/` middleware, `/healthz`, and `server/static.ts` (serves `dist/`, `index.html` for app routes, hashed `/assets/*` cached for a year, everything else incl. `sw.js` revalidated, Brotli/gzip). `Dockerfile` builds it into a `node:24-alpine` image with no `node_modules`; config comes from environment variables only.
- Screens live in `src/screens/`, shared UI components in `src/components/` (ported from the design system with the same class names).

## Conventions

- Everything in the repo and on GitHub is in English: code, comments, docs, commit messages, PR titles and descriptions, issues.
- UI copy is localized (Russian and English) with i18next. Never hardcode user-facing strings: add keys to both `src/i18n/locales/en.json` and `ru.json` (a test checks they match). Russian plurals need `_one`, `_few`, `_many` and `_other` keys.
- Work in small, reviewable PRs, one roadmap step or less each. Branch names: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Never push to `main` directly; open a PR.
- Anything to settle before the public release goes into `docs/RELEASE_CHECKLIST.md`.
- Tests sit next to the code as `*.test.ts(x)`. Query by role and accessible name.
- Accessibility is a requirement: real `<button>`/`<a>`/`<input>`, labels on icon-only buttons, touch targets ≥ 44px, visible focus, `prefers-reduced-motion` respected.

## Design

- The design lives in Claude Design: the Kinoseed canvas (screens for mobile, desktop, states) at https://claude.ai/code/artifact/d36cd9ea-367d-40f4-9cca-b5ae066c5c19 and the Kinoseed design system (tokens, components, README) at https://claude.ai/artifact/Hezz9q11HdhKm5P2bW3MTn.
- The design system's `tokens.json` is the source of truth for colors, type, spacing, radii, shadows and motion. Use the CSS custom properties, never raw hex values in components.
- Dark theme is primary; light and "follow system" are supported.
- One accent color (teal). Status colors are separate from the accent; "downloading" is the only status in the accent color.
- Font: Onest. Numbers that update (speeds, sizes, percentages) use tabular figures.

## Roadmap

1. App skeleton, lint, tests, CI ✅
2. Design tokens, themes, base components, i18n
3. qBittorrent Web API: onboarding, login, downloads list
4. TMDB: search, movie/series page, posters
5. Release search (Prowlarr/Jackett) and adding a torrent with file selection
6. Torrent details, settings, error and offline states
7. PWA: manifest, icons, install, push notifications
8. Production: Docker image, deployment next to qBittorrent, releases
