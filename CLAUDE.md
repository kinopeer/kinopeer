# Kinoseed

A qBittorrent web UI built around movies and TV series. Find a title in TMDB, pick a release via Prowlarr/Jackett, send it to qBittorrent, and manage downloads. No playback. Mobile-first PWA with a desktop layout.

## Stack

- Vite + React 19 + TypeScript (strict), Node.js 22+
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
```

Run lint, typecheck, test and build before pushing. CI must be green before merge.

## Architecture

- The browser talks to qBittorrent (and later Prowlarr) only through same-origin proxies: `/qbt/*` → qBittorrent Web UI. In dev, Vite proxies it using `QBITTORRENT_URL` from `.env.local`; in production, the Kinoseed Docker container (nginx) will. Never call those services cross-origin.
- qBittorrent Web API client: `src/api/qbittorrent/`. Session state: `src/session/useQbitSession.ts` checks `app/version` first, so qBittorrent's auth bypass (localhost or whitelisted subnets) goes straight in without a login form.
- Torrent state: `src/torrents/useMainData.ts` polls `sync/maindata` every 2 s (only while the tab is visible) and merges the incremental deltas; `src/torrents/status.ts` maps qBittorrent states to the design's statuses. Sizes, speeds and ETAs go through `src/lib/format.ts`.
- Screens live in `src/screens/`, shared UI components in `src/components/` (ported from the design system with the same class names).

## Conventions

- Everything in the repo and on GitHub is in English: code, comments, docs, commit messages, PR titles and descriptions, issues.
- UI copy is localized (Russian and English) with i18next. Never hardcode user-facing strings: add keys to both `src/i18n/locales/en.json` and `ru.json` (a test checks they match). Russian plurals need `_one`, `_few`, `_many` and `_other` keys.
- Work in small, reviewable PRs, one roadmap step or less each. Branch names: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Never push to `main` directly; open a PR.
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
