# Changelog

Kinoseed follows [semantic versioning](https://semver.org). While the version is 0.x, minor versions may change behavior and settings.

## Unreleased

### Changed

- Spacing and corner radii across the app follow the design system's scale (a 4px grid, six radii), so like things sit alike. Most gaps and paddings grew by a pixel or two; buttons, inputs, chips and cards are a little rounder.

### Fixed

- Download cards on a phone: a download's speed and time left have their own row under the status and the "done / total" size, which no longer wraps onto a line of its own. The progress bar and these rows now use the card's full width, under the More button.

## 0.4.1 - 2026-10-25

A fix for adding releases over plain HTTP.

### Fixed

- Adding a `.torrent` over plain HTTP, Kinoseed's usual address on a home network: the file is read again, so picking files works there too. Browsers have no Web Crypto outside HTTPS, so the torrent's hash is now computed by Kinoseed itself when it has to.

## 0.4.0 - 2026-10-25

Desktop: on a computer Kinoseed uses the whole window, with a sidebar, Downloads as a table or a poster grid, torrent details in a side drawer and a title's releases on its page.

### Added

- On a computer (a window 1024px wide or more), a sidebar on the left replaces the tab bar: Downloads, Search and Settings with labels, or icons only in a narrower window. Screens use the rest of the window.
- Downloads on a computer: a poster grid by default, or a table with columns for progress, status, speed, time left and size. The queue position column shows only when a torrent in the list has one. Pause or resume right from a row or a poster, filter by name and type from the header, and filter by status, sort or open a torrent's actions from menus.
- Torrent details on a computer open in a drawer over the page you opened them from, Downloads or a title's page, instead of a page of their own.
- The sidebar counts the torrents downloading and shows qBittorrent's version, speeds and free space. In a narrower window, where it shows icons only, the count is a badge on Downloads and the speeds and free space are stacked at the bottom.
- On a computer, the title page has a wide header with the poster, and its releases appear right under it after you press Find releases: filters in drop-downs over a table of releases, which stay at the top while you scroll. Opening a title no longer waits for anything from Prowlarr.
- Search and Settings on a computer: search fills the window with larger posters and a wider results grid; settings show the connections side by side and the other sections in two columns. The first-launch steps show their form in a centered card.
- On a computer, sheets open as windows in the middle of the screen: adding a release, picking its files, changing a title, deleting torrents and the rest.

## 0.3.0 - 2026-10-25

Managing downloads: sort the list, show only movies or series, and pause, resume or delete several torrents at once.

### Added

- Downloads: sort by priority (queue order), date added, name, progress, size, speed or time left. The browser remembers the choice.
- Downloads: show only movies or only series, picked in the same sheet as the sort. Torrents without a matched title count as series when their name has season markers.
- Downloads: select several torrents (Select in the header, in the list or the poster grid) and pause, resume or delete them at once.

## 0.2.0 - 2026-10-24

The title as the center: torrents are matched to their movie or series on the Kinoseed server, and the title page shows what's downloading.

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
