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

- [ ] The title page knows when the title is already in downloads (from the `tmdb:` tag). First work out on the canvas whether it merges with the torrent screen ([SPEC](SPEC.md), "Still open").
- [ ] "Change title" in the torrent menu: search TMDB and write the `tmdb:` tag.
- [ ] Download defaults are kept on the server and are the same on every device.
- [ ] On wide screens, a centered column of limited width until the desktop layout lands.

## 0.3: Managing downloads

- [ ] Sorting the list.
- [ ] Multi-select and bulk actions: pause, resume, delete.
- [x] A poster grid as a second view of the downloads list, as on the canvas.
- [ ] Reordering the download queue.

## 0.4: Desktop

- [ ] A wide-screen layout with a details side panel, as on the canvas (1440).

## 0.5: HTTPS and notifications

- [ ] Choose and document an HTTPS setup for Umbrel (options: Tailscale Serve, your own domain with Let's Encrypt).
- [ ] A "download finished" push notification.

## 1.0: Public release

- [ ] [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) is done: license, TMDB key and attribution, a history scan for secrets, screenshots, the official Umbrel App Store.

## Later, no version yet

- Installing outside Umbrel, together with Kinoseed's own login.
- More interface languages, if asked for.

## Not planned

- Automatic downloads: watchlists, RSS, new episodes (that's Sonarr and Radarr).
- Picking a season on the series page.
- Jackett.
- Playing video.
