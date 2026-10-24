# Changelog

Kinoseed follows [semantic versioning](https://semver.org). While the version is 0.x, minor versions may change behavior and settings.

## Unreleased

### Added

- Downloads: a poster grid as a second view next to the list, with status and progress over each poster. The browser remembers the choice.

### Changed

- Titles guessed from release names are saved on the Kinoseed server, so every device shows the same title and poster and each torrent is guessed once. Clear cache in Settings has them guessed again.

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
