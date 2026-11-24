# Architecture

How Kinopeer is built, area by area: where each part lives, what it does and the rules a change to it follows. What the product does is in [SPEC.md](SPEC.md), running and releasing it in [DEVELOPMENT.md](DEVELOPMENT.md), the tests in [TESTING.md](TESTING.md), and the conventions every PR follows in [CLAUDE.md](../CLAUDE.md), which loads this file into every Claude Code session.

This file is the map. Each area is described in a file of its own in [`.claude/rules/architecture/`](../.claude/rules/architecture/), which Claude Code loads when a session reads or edits a file its `paths` name (Read, Write, Edit, or `cat` of one file), not at the start, so a session carries only the areas it works in.

**Before proposing a plan or answering how something works, read the files of the areas it touches.** A search (Grep, Glob) loads none of them, and a subagent that reads the code loads them only into its own context.

## The areas

A reference elsewhere to "ARCHITECTURE → *a section*" names a section of one of these files.

| File | Sections | Loaded for |
| --- | --- | --- |
| [`server.md`](../.claude/rules/architecture/server.md) | The qBittorrent bridge, TMDB and its proxy, Why a service didn't answer, Prowlarr, The production server, The host check, Versions, release images and edge builds | `server/`, `tmdb-proxy/`, `src/api/`, the `Dockerfile`, the Vite config, the workflows |
| [`setup.md`](../.claude/rules/architecture/setup.md) | Hints for Kinopeer in a container, Find, Server-side settings, Kinopeer's own login | the server's settings, login and find, the settings and auth clients, the session, the connect, sign-in and Settings screens and their forms |
| [`notifications.md`](../.claude/rules/architecture/notifications.md) | Notifications | the notifier, Telegram and Web Push on the server, the push client, the service worker, Settings' Telegram and push cards, the notify switches |
| [`torrents.md`](../.claude/rules/architecture/torrents.md) | The qBittorrent client and torrent requests | `src/torrents/`, the qBittorrent client, the session, the torrent sheets and their hooks |
| [`torrent-state.md`](../.claude/rules/architecture/torrent-state.md) | Torrent state and the poll, Titles in Downloads, Torrent-to-title matches | `src/torrents/`, the matches, `App`, Downloads' rows, the poll's ring, the sidebar, the title cards' marks |
| [`adding.md`](../.claude/rules/architecture/adding.md) | Adding a release (Free up space with it) | `src/releases/`, `src/torrents/`, the add sheet, the releases screens |
| [`screens.md`](../.claude/rules/architecture/screens.md) | Routing, Desktop Downloads, Multi-select in Downloads, Toasts, Screens and components, A screen's own requests | `src/screens/`, `src/components/`, `src/lib/`, `src/search/`, `App` |
| [`browser.md`](../.claude/rules/architecture/browser.md) | The two builds, Preferences, PWA | `main.tsx`, the service worker, `src/pwa/`, `src/settings/`, `src/i18n/`, `src/theme/`, the Vite config, `public/` |
| [`webui.md`](../.claude/rules/architecture/webui.md) | The WebUI build: The transport, Settings in qBittorrent, Shipping it, Matches in qBittorrent, What the WebUI build shows | the transports and the WebUI's clients, its screens, texts, scripts and smoke journeys |
| [`pure-logic.md`](../.claude/rules/architecture/pure-logic.md) | Pure logic | `src/releases/`, `src/search/`, `src/torrents/`, `src/logic/`, `.oxlintrc.json` |

## Rules that reach outside their area

Each is written in its file; this list only names them, for a plan made before that file is loaded.

- A new qBittorrent call in the client: `ENDPOINTS` and `EVERY_CALL` (`server.md` → The qBittorrent bridge).
- A new TMDB path in the client: the proxy's `ROUTES`, and no path changed while a released version calls it (`server.md` → TMDB and its proxy).
- A new sheet for one torrent: the torrent requests (`torrents.md` → The qBittorrent client and torrent requests).
- No second poll of the same data, no one-off `getMainData` (`torrent-state.md` → Torrent state and the poll).
- No lazy chunk but the languages' texts (`browser.md` → PWA).
- Pure logic imports no React and no platform API (`pure-logic.md`).

## Keeping it current

A new file goes into the `paths` of its area's file. A new section goes into its area's file and into the table above. A section changes in the same PR as the behavior it describes.
