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

## 0.2: The title as the center

- [x] Torrent-to-title matches are kept on the server, the same on every device.
- [x] The title page lists this title's torrents (by their matches), each linking to its torrent screen; the two screens stay separate.
- [x] "Change title" and "Confirm" in the torrent menu: pick the title in TMDB, or accept the guess, and save it on the server.
- [x] Download defaults are kept on the server and are the same on every device.
- [x] On wide screens, a centered column of limited width until the desktop layout lands.

## 0.3: Managing downloads

- [ ] Sorting the list.
- [ ] Multi-select and bulk actions: pause, resume, delete.
- [x] A poster grid as a second view of the downloads list, as on the canvas.

## 0.4: Desktop

- [ ] A wide-screen layout with a details side panel, as on the canvas (1440).

## 0.5: HTTPS and notifications

- [ ] Choose and document an HTTPS setup for Umbrel (options: Tailscale Serve, your own domain with Let's Encrypt).
- [ ] A "download finished" push notification.

## 1.0: Public release

- [ ] [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) is done: license, TMDB key and attribution, a history scan for secrets, screenshots, the official Umbrel App Store.

## Later, no version yet

Ideas are collected in [GitHub Discussions → Ideas](https://github.com/MrShakhov/kinoseed/discussions/categories/ideas), ours included; the most upvoted ones get planned here.

- Reordering the download queue ([#38](https://github.com/MrShakhov/kinoseed/issues/38)), when people ask for it.
- Installing with plain Docker, outside Umbrel, together with Kinoseed's own login.
- Kinoseed as a qBittorrent Alternative WebUI, with no Kinoseed server: qBittorrent's API on the same origin, TMDB and Prowlarr called from the browser with the user's keys, settings and matches kept in qBittorrent's client data store (`clientdata`, qBittorrent 5.2+). Check first that Prowlarr accepts cross-origin API calls.
- More interface languages, if asked for.

## Not planned

- Automatic downloads: watchlists, RSS, new episodes (that's Sonarr and Radarr).
- Picking a season on the series page.
- Series stacks in Downloads (several torrents of one series in one card); the title page lists a title's torrents instead. Revisit only if that turns out not to be enough.
- Jackett.
- A hosted Kinoseed on our own domain for other people's qBittorrent. Browsers keep a public HTTPS page away from a home-network qBittorrent unless it is set up by hand for CORS and HTTPS, and a server in the middle would hold other people's logins and keys.
- Playing video.
