# Roadmap

Each version is a few small PRs, a `CHANGELOG.md` entry and an update of the Umbrel package. Tick an item off here in the PR that ships it.

## Done: 0.1.0 (2026-10-23)

- [x] App skeleton, lint, tests, CI
- [x] Design tokens, themes, base components, i18n
- [x] qBittorrent: connecting, login, downloads list
- [x] TMDB: search, movie and series page, posters
- [x] Release search in Prowlarr and adding with file selection
- [x] Torrent details, settings, error and offline states
- [x] PWA: manifest, icons, install
- [x] Production: Docker image, Umbrel package, releases

## Done: 0.2.0 (2026-10-24): The title as the center

- [x] Torrent-to-title matches are kept on the server, the same on every device.
- [x] The title page lists this title's torrents (by their matches), each linking to its torrent screen; the two screens stay separate.
- [x] "Change title" and "Confirm" in the torrent menu: pick the title in TMDB, or accept the guess, and save it on the server.
- [x] Download defaults are kept on the server and are the same on every device.
- [x] On wide screens, a centered column of limited width until the desktop layout lands.
- [x] A poster grid as a second view of the downloads list, as on the canvas.

## Done: 0.3.0 (2026-10-25): Managing downloads

- [x] Sorting the list.
- [x] Filtering the list by type: movies or series.
- [x] Multi-select and bulk actions: pause, resume, delete.

## Done: 0.4.0 (2026-10-25): Desktop

- [x] A wide-screen layout with a details side panel, as on the canvas (1440).

0.5 (HTTPS and notifications) was dropped on 2026-10-25; see Not planned. Versions 0.6 to 0.9 were planned on 2026-10-28.

## 0.6: Small features and fixes

- [ ] "First and last pieces first" next to sequential download: a download default in Settings and a switch in the add sheet (qBittorrent's `firstLastPiecePrio`).
- [ ] Bottom sheets on a phone close with a swipe down on the handle, and the page behind them doesn't scroll while one is open.
- [x] Settings → Connections: "Test" on a card checks only that connection, not all three.
- [ ] Interface language: a "System" option that follows the browser's language, like the system theme.
- [x] Search: rows of what's likely on torrents already ("New on digital", "New episodes", "Best of the year") from TMDB's release dates, in place of the trending and popular rows, which are mostly too new to be on trackers yet.
- [ ] Releases: the quality filters are remembered in the browser.
- [x] Adding: a warning when the files picked don't fit in qBittorrent's free space.

## 0.7: Search and discovery

- [ ] Search: a "Popular on your trackers" row, built by the server from what Prowlarr's indexers list without a query (or their RSS), kept to 2160p releases, matched with TMDB and ranked by seeders. Check first what the indexers actually return without a query.
- [x] The title page: "Recommendations" from TMDB, or "Similar titles" when it has none, in one row (see the decision log in SPEC.md).
- [x] Search: filter by year.
- [ ] Search: filter by genre.

## 0.8: Torrent control

- [ ] Torrent details: per-torrent speed limits, recheck, reannounce and moving the files to another folder.
- [ ] A switch for qBittorrent's alternative speed limits in the sidebar.
- [ ] Releases: which indexers failed, and why, when a search comes back partly empty.

## 0.9: Beyond Umbrel

- [ ] Installing with plain Docker, outside Umbrel, together with Kinoseed's own login.
- [ ] Onboarding works on a clean install with qBittorrent and Prowlarr set only through the environment.
- [ ] A Prowlarr API key field in Settings, kept on the server like the TMDB key, for installs that can't read Prowlarr's `config.xml`.

## 1.0: Public release

- [ ] [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) is done: license, TMDB key and attribution, a history scan for secrets, a bug report template and links to Ideas, required checks on `main`, screenshots, the official Umbrel App Store.

## Later, no version yet

Ideas are collected in [GitHub Discussions → Ideas](https://github.com/MrShakhov/kinoseed/discussions/categories/ideas), ours included; the most upvoted ones get planned here.

- Reordering the download queue ([idea #44](https://github.com/MrShakhov/kinoseed/discussions/44)), when people ask for it.
- Finding titles by transliterated names ([idea #87](https://github.com/MrShakhov/kinoseed/discussions/87)), when people ask for it.
- Kinoseed as a qBittorrent Alternative WebUI, with no Kinoseed server: qBittorrent's API on the same origin, TMDB and Prowlarr called from the browser with the user's keys, settings and matches kept in qBittorrent's client data store (`clientdata`, qBittorrent 5.2+). Check first that Prowlarr accepts cross-origin API calls.
- More interface languages, if asked for.

## Not planned

- Automatic downloads: watchlists, RSS, new episodes (that's Sonarr and Radarr).
- Picking a season on the series page.
- Series stacks in Downloads (several torrents of one series in one card); the title page lists a title's torrents instead. Revisit only if that turns out not to be enough.
- Jackett.
- HTTPS set up by Kinoseed, and push notifications. umbrelOS 2.0 serves every app over HTTPS with its own local certificate (`https://umbrel.local:8795`), so there is nothing for Kinoseed to set up, and it works over plain HTTP. What HTTPS adds (offline shell, installing as an app on Android and desktop, Web Push) needs the Umbrel certificate trusted on each device and, for push on iPhone, the app on the Home Screen: too much setup for one "download finished" notification. Decided 2026-10-25.
- A hosted Kinoseed on our own domain for other people's qBittorrent. Browsers keep a public HTTPS page away from a home-network qBittorrent unless it is set up by hand for CORS and HTTPS, and a server in the middle would hold other people's logins and keys.
- Playing video.
