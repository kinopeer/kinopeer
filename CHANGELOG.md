# Changelog

Kinoseed follows [semantic versioning](https://semver.org). While the version is 0.x, minor versions may change behavior and settings.

## Unreleased

### Fixed

- Desktop: Move files or Speed limits opened in a torrent's drawer while a move or save sent from Downloads is still on its way shows it busy, with what's being sent, instead of letting it be sent twice; then it closes, or says why it failed, in the drawer.
- Pause and resume: one on its way for a torrent shows busy in every place that pauses or resumes it (a row's button, the More menu, the torrent's details or drawer, the selection's bar), instead of letting it be sent twice. Once qBittorrent took it, the torrent shows Paused or its running status right away, everywhere, instead of after the next update. ([#182](https://github.com/MrShakhov/kinoseed/issues/182))
- Reannounce and force recheck: one on its way for a torrent shows busy in its More menu and recheck confirmation, on any screen, instead of letting it be sent twice after the menu or the confirmation was closed and opened again; a failure then is said in a toast instead of nowhere. Once qBittorrent took a recheck, the torrent shows Checking right away. ([#184](https://github.com/MrShakhov/kinoseed/issues/184))
- Delete: one on its way for a torrent shows busy in every delete confirmation for it (a row's, the selection's, the torrent's details or drawer), instead of letting it be sent twice after the confirmation was closed and opened again; a failure then is said in a toast instead of nowhere. Once qBittorrent took it, the torrents are gone from Downloads right away instead of after the next update. On a phone, a delete that finishes after you left the torrent's page no longer takes you to Downloads. ([#186](https://github.com/MrShakhov/kinoseed/issues/186))
- Change title and "Yes, right": a title save on its way for a torrent shows busy in Change title opened again and in every "Yes, right" for it (the More menu, the torrent's details or drawer), instead of letting another one be sent; a failure after the sheet or menu was closed is said in a toast instead of nowhere. While a torrent is being deleted, its menu and details no longer let anything else be sent for it. ([#188](https://github.com/MrShakhov/kinoseed/issues/188))
- File priorities: a change on its way for a file shows what's being sent and can't be sent again, also after leaving the torrent's page and coming back, instead of letting a second change race it; the list no longer shows the old priority again when an update sent before qBittorrent answered comes in; a failure after leaving the page is said in a toast instead of nowhere. ([#192](https://github.com/MrShakhov/kinoseed/issues/192))
- Toasts no longer hide each other: up to three show at once, stacked, each for its own 4 seconds. A toast from the page behind an open sheet, dialog or torrent drawer now shows on top of it instead of behind its backdrop, so a move or a speed limits save that failed after its sheet was closed is no longer missed on desktop.
- Phone: the on-screen keyboard no longer covers a sheet's fields (Speed limits, Move files, Change title), as it did in Safari on iOS: the sheet moves up with the keyboard and fits in what it leaves visible, and Save in Speed limits stays pinned at its bottom, as Move does in Move files.
- Move files: opened again while a move is still being sent, the sheet shows the folder being sent, not the torrent's current one, so trying again after a failure sends that folder.
- Move files, Speed limits: the fields can't be changed while a move or save is being sent; what was typed then was lost when the sheet closed.
- Downloads, torrent details: after an action (pause, speed limits, moving files and others) the new state shows right away even when Kinoseed was already asking qBittorrent for an update, instead of up to 2 seconds later.
- A torrent's menu, its delete and recheck confirmations and Change title close when the torrent is deleted and added again between two updates, as the Speed limits and Move files sheets do, instead of staying open for the new one. Confirming a delete then could delete the torrent added again.
- Phone: with the keyboard open, swiping a sheet or moving between its fields no longer scrolls the page behind it in Safari on iOS, so the sheet doesn't jerk either; the sheet also keeps a small gap above the keyboard.
- Phone: tapping a field in a sheet (Move files, Speed limits and others) with the list scrolled down no longer makes the filters disappear behind it, cuts its dimmed backdrop short or brings back a collapsed toolbar in Safari on iOS. ([#175](https://github.com/MrShakhov/kinoseed/issues/175))

## 0.6.0 - 2026-10-29

More control over torrents and an easier way to find what to download: per-torrent speed limits, moving files, reannounce and recheck, and the alternative speed limits switch; Search rows of what's likely on torrents already, a year filter and recommendations on the title page; releases that remember your filters and name the indexers that failed. Sheets on a phone close with a swipe down, and a long list of fixes.

### Added

- Releases: the filters and the sort are remembered in the browser, so the next title's releases start with the resolution, audio, source and seeds you usually pick (the indexer starts unpicked each time). A remembered filter a title's releases don't meet is skipped for that title instead of hiding everything, and named above the list with Forget. Clear all forgets the filters.
- Downloads: speed limits per torrent. "Speed limits" in a torrent's More menu sets its download and upload limits in MB/s (an empty field removes a limit), and the torrent's details list the limits that are set.
- Downloads: "Move files…" in a torrent's More menu moves its files to another folder through qBittorrent, with the folders qBittorrent already knows one tap away.
- Settings → About: links to suggest an idea, report a bug (with the version filled in) and the source code on GitHub, and TMDB's logo with the notice that Kinoseed uses the TMDB API but isn't endorsed or certified by TMDB, as TMDB's terms ask.
- Settings: the interface language has a System option, like the theme: Kinoseed follows the browser's languages (Russian or English, else English) and switches when they change. It's on for new browsers, and for existing ones whose saved language is the browser's own; a different language picked before stays.
- Title page: a row of posters at the end of the page with what to watch next, TMDB's recommendations for the movie or series, or similar titles when TMDB has no recommendations. Each poster opens its title page.
- Adding a release: a warning when the selected files are larger than the free space on qBittorrent's disk, with how much is missing. The release can still be added.
- Downloads: a turtle button switches qBittorrent's alternative speed limits on and off, and is highlighted while they apply. On a phone it's in the Downloads title row; on desktop in the sidebar's qBittorrent card (an icon in the narrow sidebar).
- Downloads and the torrent screen: "Reannounce" and "Force recheck" in a torrent's More menu. Reannounce asks the trackers for peers right away; force recheck, after a confirmation, has qBittorrent check the downloaded data again and download any broken pieces.
- Settings: the Prowlarr API key can be entered on the Prowlarr connection (the key button). Kinoseed checks it with Prowlarr, keeps it on its server, and uses it instead of the key it reads from Prowlarr's own files, for when that key can't be read. "Use the server's key" in the same sheet goes back to reading it from Prowlarr.
- Search: a year field beside Movies and Series, shown while searching, finds only titles that came out that year (for a series, the year it started), so a remake or an old film with a popular namesake is easy to find. The year stays in the address with the query, so Back from a title keeps it.
- Adding a release: "First and last pieces first" next to "Sequential download", in the add sheet's options and as a download default in Settings, which fetches the start and end of each file early; together with sequential download, a player can open a file before it's fully downloaded.
- Releases: the indexer's name on a release (the card on a phone, the table on desktop and the add sheet) links to the release's page on the tracker, in a new tab, for what Kinoseed doesn't show.
- Releases: when indexers fail during a search (blocked, timed out, or put on hold by Prowlarr after failures), a quiet note above the results names them, so missing releases aren't a mystery.

### Changed

- Search: before a search the rows show what's likely on torrents already: "New on digital" (movies out on digital or disc in the last two months), "New episodes" (series with an episode in the last two weeks) and "Best of the year" (the best rated movies out on digital or disc in the last year). Before, they showed TMDB's trending and popular titles, often still in cinemas and not on torrents yet. A row TMDB has nothing for, or that fails to load, is hidden; when the type picked has no rows left, Search says so (or shows the error) with Try again.
- Desktop: on the title page the poster stays at the top of the hero, by the title, however long the overview is, and an overview longer than five lines is cut with "Show more" that opens the rest in place, the blurred background staying put. Before, a long overview left the poster at the bottom with empty space above it.
- Downloads: the filters, the sort and the view stay at the top while the list scrolls (on a phone the title and the totals scroll away; on desktop the whole header stays, with the table's column names under it), and so do the count, "Select all" and "Cancel" while selecting.
- Downloads: while selecting, the count stands on the left, where the title was, and "Select all" and "Cancel" sit together on the right, where the Select button is, so the pointer is already there.

### Fixed

- Desktop: clicking a disabled item in a menu, such as Reannounce on a paused torrent, no longer closes the menu in a torrent's drawer, and the arrow keys keep working in it afterwards. ([#159](https://github.com/MrShakhov/kinoseed/issues/159))
- Settings: when qBittorrent was unreachable as Settings opened, Test on its card now also loads the categories, so the Movies and Series category selects work without reopening Settings. ([#132](https://github.com/MrShakhov/kinoseed/issues/132))
- Preferences changed in one tab are no longer undone by a change in another tab open since before: each tab reads them again when another saves them. ([#154](https://github.com/MrShakhov/kinoseed/issues/154))
- Adding a release: the save path field no longer zooms the page in on an iPhone, and the folder shown under the options is the one qBittorrent will use: a category's folder only when qBittorrent puts new torrents there (automatic management, or category paths in manual mode), placed as qBittorrent places it.
- Desktop: "Find releases" on a title page no longer reloads the whole page: the hero, an opened overview and the rest stay as they were, and the page scrolls smoothly down to the releases. ([#138](https://github.com/MrShakhov/kinoseed/issues/138))
- When qBittorrent can't tell its free space (it reports 0), Downloads, the sidebar and the add sheet's files row no longer say "0 B free", and the file picker no longer says "Not enough free space". ([#137](https://github.com/MrShakhov/kinoseed/issues/137))
- Phone: a sheet (sort and filters, adding a release, a torrent's actions…) closes when dragged down by its grabber or title, as the grabber suggests, and the screen behind it no longer scrolls under the finger. ([#114](https://github.com/MrShakhov/kinoseed/issues/114))
- Phone: a sheet also follows a drag that starts while it is still sliding up. ([#150](https://github.com/MrShakhov/kinoseed/issues/150))
- In a narrow window, a sheet follows a mouse drag that starts on the poster at its top, instead of springing back. ([#150](https://github.com/MrShakhov/kinoseed/issues/150))
- Desktop: a release name no longer looks clickable on hover (a click did nothing when the name fit in two lines); the whole name is a tooltip on hover instead. On a phone a tap still shows the whole name.
- Desktop: Escape in the delete confirmation or the title search opened from a torrent's details closes only that, not the details too. ([#107](https://github.com/MrShakhov/kinoseed/issues/107))
- Desktop: a link to a title's releases (or a reload of their address) opens the title page at the releases, instead of at the top with the hero. ([#72](https://github.com/MrShakhov/kinoseed/issues/72))
- Releases: a resolution written in the name wins over a UHD or 4K marker, so "UHD BDRip 1080p" shows as 1080p, not 2160p. HDRip is a source of its own, with its own filter, instead of showing as BDRip.
- Search: going back from a title brings the results back at the same scroll position. Before, the list started from the top, because the results load again after the browser has already restored the scroll.
- Settings: Test on a connection checks only that service, and saving a new TMDB key checks only TMDB. Before, every connection was checked again. ([#113](https://github.com/MrShakhov/kinoseed/issues/113))
- Settings: switching the language while a connection is being checked no longer leaves it on "Testing…" when the earlier check answers last. ([#139](https://github.com/MrShakhov/kinoseed/issues/139))
- Search: typing and then clearing the field while the rows load no longer shows only the rows that had loaded, as if loading were done. ([#139](https://github.com/MrShakhov/kinoseed/issues/139))

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
