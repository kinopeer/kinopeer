# Changelog

Kinoseed follows [semantic versioning](https://semver.org). While the version is 0.x, minor versions may change behavior and settings.

## Unreleased

### Added

- Releases: the filters and the sort are remembered in the browser, so the next title's releases start with the resolution, audio, source and seeds you usually pick (the indexer starts unpicked each time). A remembered filter none of a title's releases meets is skipped for that title instead of hiding everything. Clear all forgets the filters.
- Releases: the indexer's name on a release (the card on a phone, the table on desktop and the add sheet) links to the release's page on the tracker, in a new tab, for what Kinoseed doesn't show.

### Changed

- Desktop: on the title page the poster stays at the top of the hero, by the title, however long the overview is, and an overview longer than five lines is cut with "Show more" that opens the rest in place, the blurred background staying put. Before, a long overview left the poster at the bottom with empty space above it.
- Downloads: the filters, the sort and the view stay at the top while the list scrolls (on a phone the title and the totals scroll away; on desktop the whole header stays, with the table's column names under it), and so do the count, "Select all" and "Cancel" while selecting.
- Downloads: while selecting, the count stands on the left, where the title was, and "Select all" and "Cancel" sit together on the right, where the Select button is, so the pointer is already there.

### Fixed

- Desktop: a release name no longer looks clickable on hover (a click did nothing when the name fit in two lines); the whole name is a tooltip on hover instead. On a phone a tap still shows the whole name.
- Desktop: Escape in the delete confirmation or the title search opened from a torrent's details closes only that, not the details too. ([#107](https://github.com/MrShakhov/kinoseed/issues/107))
- Desktop: a link to a title's releases (or a reload of their address) opens the title page at the releases, instead of at the top with the hero. ([#72](https://github.com/MrShakhov/kinoseed/issues/72))
- Releases: a resolution written in the name wins over a UHD or 4K marker, so "UHD BDRip 1080p" shows as 1080p, not 2160p. HDRip is a source of its own, with its own filter, instead of showing as BDRip.
- Search: going back from a title brings the results back at the same scroll position. Before, the list started from the top, because the results load again after the browser has already restored the scroll.

## 0.4.2 - 2026-10-26

Polish: spacing, corner radii and text sizes follow the design system across the app, the theme follows the system on every screen, and download cards on a phone lay out their speed and time left on a row of their own.

### Changed

- Spacing and corner radii across the app follow the design system's scale (a 4px grid, six radii), so like things sit alike. Most gaps and paddings grew by a pixel or two; buttons, inputs, chips and cards are a little rounder.
- Text sizes follow the design system's type roles, so text of the same kind reads the same everywhere. Small meta text (release names, sizes, speeds, percentages) is a pixel larger; badges and the tab bar's labels half a pixel smaller; the title's name on a wide screen and the torrent's big percentage are a step smaller.

### Fixed

- With the theme set to follow the system, Kinoseed switches between light and dark as soon as the system does, on every screen. Before, an open page kept its theme until it was reloaded, unless Settings was open.
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
