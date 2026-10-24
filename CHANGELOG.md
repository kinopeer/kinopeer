# Changelog

Kinoseed follows [semantic versioning](https://semver.org). While the version is 0.x, minor versions may change behavior and settings.

## 0.2.0 - 2026-10-25

The title as the center: each torrent is tied to its movie or series, and the title page lists them. Those matches and the download defaults are kept on the Kinoseed server, the same on every device.

### Added

- Title page: an "In downloads" block with a card for each of the title's torrents (season and episodes, resolution, progress, status), each opening its torrent screen, and a badge in the header. The torrent menu links back with "Movie page" or "Series page".
- Change a torrent's title: search TMDB from the row menu or the torrent screen's More button and pick the right movie or series. A title guessed from the release name asks whether it's right; "Yes, right" keeps it. The choice is saved on the Kinoseed server and shows on every device.
- Downloads: a poster grid as a second view next to the list, with status and progress over each poster. The browser remembers the choice.

### Changed

- Titles guessed from release names are saved on the Kinoseed server, so every device shows the same title and poster and each torrent is guessed once. Clear cache in Settings has them guessed again.
- Download defaults in Settings (categories, start paused, sequential) are saved on the Kinoseed server and are the same on every device. Defaults already set in a browser are taken over the first time it opens the new version.
- The saved title of a deleted torrent is forgotten: right away when it is deleted from Kinoseed, or after a week when it is deleted in qBittorrent itself.
- On a computer or tablet, every screen, Search included, sits in the same centered column, and the tab bar's tabs stay over it instead of spreading across the window.

## 0.1.0 - 2026-10-23

The first release, for private testing on an Umbrel home server.

### Added

- Downloads: live list of qBittorrent torrents with TMDB titles and posters, status, progress, speeds and ETA; pause, resume and delete.
- Torrent details: files as a folder tree with priorities, speeds, seeds and peers, ratio, trackers and save path.
- Search: movies and series from TMDB, title pages with overview, rating and seasons.
- Releases: search through Prowlarr, quality filters (resolution, source, HDR, voice-over, seasons) and sorting; adding a release to qBittorrent with category, save path and file selection.
- Settings: connection checks, download defaults, theme, language, TMDB language, cache reset.
- Offline and error states: last known state under an offline banner, crash screen with Reload.
- Installable PWA with an app shell that works offline.
- Production server and Docker image (`linux/amd64`, `linux/arm64`).
- The TMDB key and the qBittorrent login are entered in the app and kept on the server; Prowlarr's API key can be read from its `config.xml`.
