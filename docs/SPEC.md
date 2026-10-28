# Product spec

What Kinoseed does and why, as of version 0.4.2. Update it in the same PR that changes the behavior; add new decisions to the log at the end.

## Goal

Find a movie or a series, pick a release and download it without leaving Kinoseed. If a flow makes you switch to another app (a tracker's website, qBittorrent's own web UI), that's a gap to close.

## Who it's for

The owner of a home server running umbrelOS with the qBittorrent and Prowlarr apps. The main device is a phone, then a computer. The interface is in Russian and English.

## What Kinoseed doesn't do

- Play or stream video.
- Automate downloads: no watchlists, RSS or automatic search for new episodes. That's Sonarr and Radarr; Kinoseed is for picking a specific release by hand.
- Pick a season on the series page: a series is searched by name, and the seasons and episodes you want are picked in the file list.
- Manage a media library or rename files.
- Store tracker logins or get around site protection: trackers are set up in Prowlarr. Jackett is not supported.
- Collect analytics.
- Install outside Umbrel, for now.

## Platform

The `homelab-kinoseed` package from the Homelab App Store runs on port 8795, depends on the qBittorrent and Prowlarr apps and works without setup. The browser only talks to the Kinoseed server, on the same origin; the server talks to qBittorrent, Prowlarr and TMDB and keeps every secret to itself. Umbrel's login protects Kinoseed.

| Setting | Where it's kept | Set by |
| --- | --- | --- |
| 2026-10-28 | Moving a torrent's files is one torrent at a time from its More menu, through qBittorrent's own move (`setLocation`), which also works on qBittorrent 4.x. The folder is free text plus qBittorrent's known folders, because Kinoseed can't browse the disk qBittorrent sees; the category isn't changed with it, since a category is also a label. Moving several selected torrents at once can come later. |
| 2026-10-25 | Desktop Settings put download defaults and About in the left column and Appearance in the right, the other way round from the canvas, so reading the columns row by row follows the order on a phone and the keyboard order. About keeps its rows (version, install, clearing the cache with its hint) rather than the canvas's one line. Rows of posters in desktop Search show a thin scrollbar where the pointer is a mouse, which can't swipe them sideways. |
| qBittorrent and Prowlarr addresses | Server environment | The Umbrel package |
| Prowlarr API key | Environment or Prowlarr's `config.xml` | The Umbrel package |
| qBittorrent login | `/data/settings.json`, else environment | The connect screen |
| TMDB key | `/data/settings.json`, else environment | Onboarding or Settings |
| Download defaults (categories, start paused, sequential) | `/data/settings.json`; a copy in the browser | Settings |
| Theme, interface language, TMDB language | Browser | Settings |
| Downloads view and sort | Browser | Downloads |
| Torrent-to-TMDB matches | `/data/matches.json`; titles and posters cached in the browser | Guessed automatically; the torrent menu |

A torrent's match is forgotten when the torrent is deleted from Kinoseed. For torrents deleted elsewhere, the server checks qBittorrent's list every hour and forgets a match once its torrent has been missing for a week, so a qBittorrent that answers with an empty list after a restart, or a torrent added back, loses nothing.

## Screens

### Navigation and layout

- Phones and tablets (narrower than 1024px): a tab bar at the bottom with Downloads, Search and Settings. On a tablet, screens sit in a centered column 760px wide and the tabs stay over it.
- Desktop (1024px and wider, the design system's breakpoint): a sidebar on the left with the Kinoseed logo and the same three destinations, in place of the tab bar. From 1100px it is 248px wide with labels; between 1024 and 1100px it is a 76px rail of icons, the labels kept for screen readers. Screens take the rest of the window. Until their own desktop layouts land in 0.4 they keep the 760px column, centered in that space.
- Selecting downloads puts the bulk bar in place of the tab bar on a phone; on desktop the sidebar stays and the bulk bar sits at the bottom of the screen beside it.
- On desktop the sidebar also counts the torrents downloading next to Downloads and, at the bottom, shows qBittorrent's version, total speeds and free space, or that it doesn't answer. In the icon rail the count is a badge on the Downloads icon, and the status a narrow column at the bottom: a green or red dot, then the download and upload speeds and the free space, each number over its unit.
- Sheets slide up from the bottom on a phone. On desktop the same sheets are modals in the middle of the window, over a dimmed backdrop that covers the sidebar too: 600px wide and as tall as their content, or 680 × 720px for long lists (picking files, changing a title), which on a phone take the full height. Confirmations (deleting torrents) are 440px wide with their buttons on the right. Escape and a click on the backdrop close them; focus stays inside and returns to what opened them.

### First launch

1. Kinoseed asks qBittorrent for its version. If the server is already signed in (the package's login or a saved one) or qBittorrent lets the network in without a password, there's no login form.
2. Otherwise, the qBittorrent login form. The server tries a password once and doesn't retry after a rejection: qBittorrent bans the IP for an hour after five failures.
3. The "Connect TMDB" step: a v3 API key or a v4 read access token, checked with TMDB before it's saved. It can be skipped; search then asks for the key later.

On desktop these steps show their form in a card centered in the window, without the sidebar.

### Downloads

- Every qBittorrent torrent, refreshed every 2 seconds while the tab is visible.
- A row shows the TMDB poster and title, status, progress, speed, time left and queue position. The title comes from the user's choice, else the `tmdb:<movie|tv>:<id>` tag, else a guess from the release name. Guesses are saved on the server, so every device shows the same title and each torrent is guessed once.
- A list or a poster grid (status and progress over the poster, percent and speed or size under it). The list is the default on a phone and the grid on desktop; each layout remembers its own choice in the browser.
- On desktop the list is a table: queue position (a column only when some torrent shown has one, so only with the Priority sort; in selection mode it holds the checkboxes), poster, title and release, progress, status, speed, time left, size, then Pause or Resume and More. A click anywhere on a row opens its details (in selection mode, selects it); the row is one link, its title, with the buttons on top. The title takes the room the other columns leave, so it grows with the window. The size column shows only in a wide window (about 1550px and up), where the title still has about 380px; narrower, it goes, and narrower still the time left moves under the speed, so the title keeps at least 200px. The grid is wider, and a poster shows Pause or Resume in its corner on hover. The name filter always shows in the header and narrows rather than wrapping. Under it, on one row at every desktop width: the filters on the left, the status as a button with the picked status and its count ("All statuses 15", "Seeding 13") and the type (All, Movies, Series); the sort and the view on the right. The status, the sort and a row's More open as menus next to their button rather than sheets, and their button closes them again; the status menu lists each status with its count. While another status is picked and some torrents have errors, the status button has a small red dot (and says so to screen readers), so errors don't go unnoticed. Phones keep the status chips.
- Filters by status and name, total speeds, free space.
- While the list scrolls, the controls stay at the top. On a phone that's the bar with the status chips, the sort and the view (and the name field while it's open), with the selection's count and buttons in it while selecting; the title and the totals scroll away. On desktop the whole header stays, and the table's column names stick right under it.
- A type filter: All, Movies or Series. A torrent's type is its title's; a torrent without a title yet counts as a series when its name has season or episode markers, or by its qBittorrent category ("Movies", "TV Shows"), and otherwise shows only under All. The status chips (the status menu on desktop) count within the type. A badge with the type sits next to the sort while it isn't All. Like the status filter, the type lasts while the screen is open, and Reset filters resets it too.
- Sorting: Priority (qBittorrent's queue order, the default), Date added (newest first), Name (A to Z by the title the row shows), Progress (most first), Size (largest first), Speed (fastest download first, then upload), ETA (soonest done first; torrents without a time left go last). Ties keep the queue order. The queue position on the poster shows only with Priority. The sort and the type are picked in the "Sort & filter" sheet; the sort is remembered in the browser.
- Selection: the Select button in the header turns rows and cards into checkboxes (tapping anywhere on one toggles it) and puts Pause, Resume and Delete in place of the tab bar. The header shows how many are selected, with Cancel and "Select all" ("Deselect all" once everything shown is selected). Only the torrents the filters show count, so a filter never leaves hidden ones selected. Delete asks once for all of them, with the same "Also delete files" box and the total downloaded size. After an action the selection ends; if qBittorrent doesn't answer, it stays. Selecting is off while qBittorrent is unreachable.
- Row menu: pause or resume, details, the title's page, change the title, move the files, delete with or without files. When the title was guessed from the release name, the menu asks "Matched by the release name. Is it right?" with Change and "Yes, right" instead of the Change title item.
- Statuses: Downloading (the only one in the accent color), Seeding, Paused, Completed, Queued, Checking, Error.

### Torrent

- On a phone, a screen of its own. On desktop, a drawer on the right over the page it was opened from (Downloads, or the title page's "In downloads"), which stays as it was behind it, with its scroll, filters, selection and searched releases: Escape, Close or a click outside closes it and goes back to that page, with focus back on the row or card. The address is the torrent's either way. Over the title page, deleting the torrent closes the drawer and the title page drops it from "In downloads", and the More menu's movie or series page of that same title just closes the drawer. A shared link or a fresh load of the torrent's address opens the drawer over Downloads, and closing it goes to Downloads.
- Pause, resume, delete; progress, time left, ratio. The More button opens the same menu as the row.
- A guessed title gets the same "Is it right?" card under the heading; when no title was found, "Pick title".
- Changing the title: a TMDB search that starts from the name read from the release, with All, Movies and Series; the current title comes first and is marked. Picking a title, or "Yes, right", saves it on the Kinoseed server as the user's choice, which wins over the tag and any guess.
- Files as a tree, as in the torrent, without regrouping, but without the torrent's single root folder; sorted by name, numbers by value. Priorities: Skip, Normal, High.
- Speeds, seeds and peers, save path, category, date added, info hash, trackers.
- Moving the files: "Move files…" in the More menu opens a sheet with the folder, starting at the current one, and the folders qBittorrent already knows (its default save path and the categories' paths) as chips. Move hands the folder to qBittorrent, which creates it if needed and moves the files in the background; a toast says where they're going. The torrent's category stays as it is. If qBittorrent can't write there, the sheet stays open with an error. Off while qBittorrent is unreachable.
- Clear messages for disk errors and missing files.

### Search

Movies and series from TMDB with a type filter. An empty search shows trending this week and popular titles. The query and type live in the page URL, and Back from a title returns to the results at the same scroll position.

On desktop the screen fills the window beside the sidebar: the search field up to 640px wide, rows of larger posters (with a thin scrollbar for a mouse) and results in a grid as wide as the window.

### Title

Poster, year, runtime or number of seasons and episodes, rating, overview, and a "Find releases" button.

- "In downloads": under the overview, a card for each of this title's torrents (by the same match the downloads list shows: the user's choice, the tag or a guess), newest first. A card shows the season and episodes read from the release name ("S02 E01–05") and the resolution, the release name, progress, status, speed and size, and opens the torrent screen. Hidden when there are none, and when qBittorrent doesn't answer before the first refresh.
- A badge in the header: "In downloads · 41%" for one torrent, "In downloads · 3" for several.
- The way back: the torrent's menu (in Downloads and on the torrent screen) has "Movie page" or "Series page".
- Desktop: a wide hero over the blurred poster (poster, title, original name, year and runtime or seasons, rating and genres in one line, the overview), with "Find releases" in it and the series hint beside the button. The poster stays at the top, by the title, however long the overview is; an overview longer than five lines is cut there, with "Show more" under it that opens the rest in place (and "Show less"). "In downloads" cards sit side by side under the hero. Opening the page sends no request to Prowlarr: pressing "Find releases" searches and shows the releases under the hero, scrolled to, and the address becomes the releases one. That address opens the page with the releases searched, starting at them with no scroll animation. Back leaves the page, whether or not the releases were searched; pressing the button again scrolls back to them.

### Releases

- The query is the original title, plus the year for a movie. No category filter: some indexers (RuTor, for example) file everything under "Other".
- Resolution, source, HDR, audio and seasons are read from the release name. A resolution written as a number wins over a UHD or 4K marker ("UHD BDRip 1080p" is 1080p). HDRip is a source of its own, not BDRip: it's an HD rip, usually of a WEB or HDTV source.
- Filters: resolution, audio, source, minimum seeds, indexer. Sort by seeds, size or date.
- The indexer's name on a release (the card, the table row and the add sheet) links to the release's page on the tracker, in a new tab, for what Kinoseed doesn't show: the description, screenshots, comments. Plain text when the indexer gives no page.
- A release name is clipped to two lines. On a phone a tap shows the whole name; on desktop the whole name is a tooltip on hover, and the name isn't a button.
- Phone: a screen of its own with a back button; the filters are in a sheet and releases are cards.
- Desktop: on the title page (see Title). A bar that stays at the top while scrolling holds a chip per filter, each opening its values in a popover (Escape or a click outside closes it), and the sort with its direction. Picked filters show as removable chips with "Clear all". Releases are a table: release name with season and quality badges, audio, size, seeds, peers, indexer, age and Add. Below 1400px the audio badges move under the name.

### Adding

- Kinoseed gets only the `.torrent` (preferred, so files can be picked) or the magnet link from Prowlarr and adds it to qBittorrent itself. Prowlarr's own download clients aren't used.
- Options: category (the default from Settings, else a qBittorrent category with a matching name such as Movies or TV Shows), save path, start paused, sequential, add to the top of the queue.
- File selection and a free space check. With skipped files, the torrent is added stopped, the skipped files get priority 0, then it starts. A magnet link downloads every file.
- The torrent gets the `tmdb:<movie|tv>:<id>` tag; after adding, the app goes to Downloads and shows a toast.

### Settings

Appearance (theme, language), Connections (checks for qBittorrent, Prowlarr and TMDB, changing the TMDB key), download defaults (the same on every device; another device's change shows after a reload), the language of TMDB titles and overviews, About (version, clear cache, install). Clearing the cache also forgets the server's guesses, so torrents are matched again; the user's choices stay. Service addresses can't be changed here: the package sets them.

On desktop the connections sit side by side across the top, then two columns: download defaults and About on the left, Appearance on the right.

### Offline and errors

- qBittorrent stops answering: the last state stays under a banner with its age, actions are disabled, retries are automatic.
- Before the first answer: a "qBittorrent is unreachable" screen.
- A screen crashes: an error screen with a Reload button.

### App (PWA)

Manifest and icons; the service worker keeps the app shell available offline and caches posters, and never caches qBittorrent, Prowlarr or TMDB data. A new version takes over right away. The service worker needs HTTPS, so it doesn't run over plain HTTP on the home network; umbrelOS 2.0 serves Kinoseed over HTTPS too, with Umbrel's own certificate, and Kinoseed sets up nothing for it. Everything else, reading `.torrent` files included, works over plain HTTP.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-10-27 | In the desktop hero the poster is aligned with the title at the top (the canvas aligned the text's bottom with the poster's), and an overview longer than five lines is cut with "Show more". With the bottom alignment a long overview (Russian TMDB overviews often run to ten lines) left the poster hanging at the bottom with empty space above it and the title far from it, and the hero grew with the text, pushing "Find releases" down. Five lines is about the poster's height, so a typical overview still shows whole. |
| 2026-10-27 | Downloads keeps its controls on screen while the list scrolls, as Search and the releases already do: a long list otherwise leaves the filters, the sort and the selection's count and Cancel out of reach, with the bulk bar still fixed at the bottom. On a phone only the bar with the chips, the sort and the view (the selection row while selecting) is pinned, not the whole header: the title and the totals would cost a quarter of the screen for nothing that's acted on. On desktop there's room for the whole header, and the table's column names stick under it. |
| 2026-10-27 | The indexer's name on a release links to the release's page on the tracker. Leaving Kinoseed for a tracker's site is still a gap in the flow, but this link is an exit for what Kinoseed doesn't show (the description, screenshots, comments, the exact audio tracks), not a step in it: the release is picked and added here. Tracker logins stay out of scope. The name is the link rather than a button of its own: the card and the table are already dense, and the name already says where the release is from. |
| 2026-10-26 | A release name with a Russian title spelled in Latin letters ("Molchanie.Yagnyat") isn't matched to a TMDB title: TMDB doesn't search transliterations, so the torrent gets "Pick title" and the user picks it by hand. Spelling the name back in Cyrillic and searching again was tried: it finds about half of the titles (a lost soft sign or doubled letter breaks TMDB's exact search) and can match an English name that TMDB didn't find to a random Russian title. It stays [an idea in Discussions](https://github.com/MrShakhov/kinoseed/discussions/87). |
| 2026-10-25 | HTTPS and push notifications (the 0.5 plan) are dropped. umbrelOS 2.0 serves every app over HTTPS with its own local certificate on the same port as HTTP, so an HTTPS setup by Kinoseed (Tailscale Serve, a domain with Let's Encrypt) has nothing left to do, and the `requiresHttps` manifest field isn't set: Kinoseed works over HTTP and the field would drop umbrelOS 1.x. A "download finished" push would need the Umbrel certificate trusted on each device and, on iPhone, the app on the Home Screen, plus Web Push on the server, for one notification in a home app. The service worker and installing as an app stay available to anyone who opens Kinoseed over HTTPS with the certificate trusted. |
| 2026-10-25 | The Claude Design canvas is no longer kept in sync with the app after 0.4.0: a sync round costs a lot (one large prototype file to read, edit and publish) for little use once the screens exist in code. The app, `docs/SPEC.md` and the design system's tokens are the reference; the canvas stays as a picture of 0.4.0 and is drawn on only when a new screen needs variants compared. |
| 2026-10-25 | Keyboard navigation and focus management (tab order, where focus goes when a sheet, menu or drawer opens or closes) aren't a goal for now; the basics stay: real buttons and links, labels on icon-only buttons, 44px touch targets. Focus rings show only for keyboard navigation: after a click or tap they're off until the next key press, because browsers also show them when a dialog opens or the app moves focus, which looked like a stray highlight to people using a mouse. The icon rail shows the speeds and free space as a narrow column and the downloading count as a badge, rather than hiding them, so the status is there at every desktop width. The table's "#" column shows only when a torrent shown has a queue position, so the title gets the room otherwise. |
| 2026-10-25 | On desktop the torrent drawer opens over the page its link is on (the title page as well as Downloads) instead of always over Downloads, so looking at a title's torrent doesn't leave the title: the link carries the page in the navigation state and the app keeps rendering that page under the drawer. Closing goes back one step in history, to the page as it was. A torrent's address loaded with no page behind it (a shared link, a new tab) shows Downloads under the drawer, as before. This supersedes "on desktop, `/torrent/:hash` shows Downloads with the torrent's details in a side drawer" below. |
| 2026-10-25 | On desktop the status filter is one button that opens a menu of statuses with their counts, rather than the canvas's row of six chips: the chips, the type, the sort and the view need about 1100px, so below the canvas's 1440px they wrapped onto two or three rows. A dot on the button marks errors hidden by the picked status. Phones keep the chips, which scroll sideways. The desktop table gives its title the room the fixed columns leave, so it gets wider with the window, and keeps it readable (200px or more) by dropping the size and then moving the time left under the speed as the table narrows; the size comes back only where the title keeps about 380px beside it, so a wider window never shows a narrower title than a smaller one. The title is what a row is recognized by, and the size and time left are in the details drawer. |
| 2026-10-25 | Desktop Downloads follows the canvas: the poster grid is the default there (the phone keeps the list), and the list becomes a table with columns. Each layout remembers its own view, since a phone and a desktop are usually different screens. The sort and the row's More open as menus next to their button, as drawn; the type moves from the sort sheet to a segmented control beside the sort. The canvas's grouping of several torrents of one title into an expandable row isn't built: the app has no grouping on a phone either. The sidebar's qBittorrent card shows free space as text, without the canvas's disk bar, because qBittorrent reports free space but not the disk's size. The drawer and the sidebar share the Downloads poll of qBittorrent rather than polling again; on desktop that poll runs on every screen, for the sidebar. |
| 2026-10-25 | Desktop releases are on the title page and searched only when "Find releases" is pressed (rather than on opening the title, or on a page of their own as on phones): a title opened to read about it costs no Prowlarr request, and the releases stay next to what they're for. The search gets its own address (`/title/:type/:id/releases`, the phone's releases address) so it can be linked and survives a reload; pressing the button replaces the title's address rather than adding one, so Back leaves the page instead of only hiding the releases. Filters open as popovers from a sticky bar, not the phone's sheet. |
| 2026-10-25 | On desktop, sheets and dialogs become centered modals, as the canvas draws them (`ks-modal`), rather than bottom sheets or a separate component: every sheet works the same way on both, and a screen picks only the size (`Sheet size="lg"` for long lists). Footer buttons keep their own width on the right, like the canvas's modals. Sheets that are menus or quick pickers (the row menu, sort, release filters) are modals too for now; the screens' own desktop layouts may turn them into popovers. |
| 2026-10-25 | The desktop layout (0.4) starts at 1024px, the design system's breakpoint; the sidebar is an icon rail up to 1100px, as the design system's README says. Below 1024px the phone layout stays, tablets included. On desktop, `/torrent/:hash` shows Downloads with the torrent's details in a side drawer rather than a page of its own, and the title page shows releases in place, searched only when the user presses "Find releases", so opening a title sends no request to Prowlarr. The desktop canvas predates 0.2 and 0.3, so where it lacks later features (the title's "In downloads" block, sort, the type filter, multi-select, changing a title) the app as built is the reference. In selection mode the sidebar stays: navigation is still useful, and leaving Downloads ends the selection. |
| 2026-10-25 | Multi-select follows the canvas: a Select button rather than a long press (which a phone browser saves for its own menu and a desktop doesn't have), and the bulk bar in place of the tab bar. Bulk actions apply to the selected torrents the filters show. The poster grid gets selection too: a checkbox in the poster's corner, which the canvas didn't draw. |
| 2026-10-25 | The Downloads type filter (All, Movies, Series) is in the "Sort & filter" sheet, as on the canvas. A torrent's type comes from its title, else from what is known without TMDB: season or episode markers in the name make it a series, then the qBittorrent category; with neither, it shows only under All. The canvas treated every unmatched torrent as a series, which would put unmatched movies and non-video torrents there. The type isn't remembered, like the status filter, so a release just added of another type isn't hidden; Reset filters resets it, and the status counts are within the type. |
| 2026-10-25 | Downloads sorting ships on its own: the sheet has the sort only, and the Movies/Series type filter from the canvas's "Sort & filter" sheet comes separately. The sort is remembered per browser, like the view, rather than on the server; it can move there later if the same order on every device turns out to matter. Picking a release doesn't reset the sort. |
| 2026-10-24 | Download defaults (categories, start paused, sequential) are kept on the Kinoseed server, so every device adds releases the same way; each one is saved on its own, so changes on two devices don't undo each other. The browser keeps a copy and uses it when there's no server. Defaults set in a browser before 0.2 are sent to the server by the first browser that has them. Theme, interface language, TMDB language and the Downloads view stay per browser: they depend on the device. |
| 2026-10-24 | Until the desktop layout (0.4), every screen on a wide screen, Search included, sits in one centered column 760px wide, and the tab bar's tabs stay over it. One width for all, so switching tabs doesn't shift the header; Search shows fewer posters per row than its old 1200px. |
| 2026-10-24 | The title page's "In downloads" block shows each torrent as a separate card, newest first, with its season and episodes, rather than one merged entry per title. Small changes like this are built and tried on the test stand first, and the canvas is updated after. |
| 2026-10-24 | Two more ways to install are kept in mind: plain Docker without Umbrel, and Kinoseed as a qBittorrent Alternative WebUI with no server of its own (this reopens the 2026-10-20 decision as a second option, not a replacement). Until then, whatever the Kinoseed server does has a fallback in the browser or is an extra the app works without, and pure logic stays free of React, the DOM and Node. That's why guessing titles from release names stays in the browser rather than moving to the server. A hosted Kinoseed for other people's qBittorrent is dropped. |
| 2026-10-24 | A guessed title asks "Is it right?" with Change and "Yes, right" (on the torrent screen and in the row menu) rather than a separate "Confirm match" menu item, which didn't say what it confirmed. Guessed rows in Downloads carry no marker. |
| 2026-10-24 | Matches of deleted torrents are forgotten: right away when deleted from Kinoseed, otherwise after a week missing from qBittorrent (checked hourly). The week guards against qBittorrent listing nothing for a while after a restart. |
| 2026-10-24 | Torrent-to-title matches are kept on the Kinoseed server (`/data/matches.json`), not in qBittorrent tags: qBittorrent's tag list stays clean and every device shows the same. A guess made in a browser is saved there; the user's choice wins over the `tmdb:` tag, which wins over a guess. Kinoseed still tags the torrents it adds. |
| 2026-10-24 | Discussions are on before the public release; our own ideas go to Ideas too, not to issues. |
| 2026-10-24 | Reordering the download queue is deferred until people ask for it ([#38](https://github.com/MrShakhov/kinoseed/issues/38)). Feature requests go to GitHub Discussions (Ideas) and are voted on there; issues are for bugs and accepted work. |
| 2026-10-24 | No series stacks in Downloads: every torrent keeps its own row or card. A title's torrents are found from its page instead. |
| 2026-10-24 | The title page and the torrent screen stay separate; the title page links to the screens of its torrents. |
| 2026-10-24 | Downloads open as a list by default; the poster grid is a per-browser choice until the desktop layout decides its own default. |
| 2026-10-23 | Umbrel is the only supported install; other ways to install come later. |
| 2026-10-23 | No Sonarr/Radarr-style automation and no season picker on the series page. |
| 2026-10-23 | Prowlarr only; no Jackett. |
| 2026-10-23 | Interface languages: Russian and English. |
| 2026-10-23 | Everyone brings their own TMDB key; a built-in key is decided before the public release. |
| 2026-10-23 | The Umbrel package tries the `admin`/`adminadmin` qBittorrent login once. |
| 2026-10-23 | Version 1.0 is the public release. |
| 2026-10-23 | HTTPS is deferred; the app runs over HTTP on the home network. |
| 2026-10-22 | The TMDB key and the qBittorrent login are entered in the app and kept on the server; addresses come from the environment. |
| 2026-10-22 | Files are shown as a tree, as in the torrent, without grouping by season. |
| 2026-10-22 | Release search uses no category filter. |
| 2026-10-21 | Search and adding happen inside Kinoseed; "find it in the browser and hand it over" was rejected. |
| 2026-10-21 | Releases come from Prowlarr; Kinoseed doesn't scrape trackers. |
| 2026-10-20 | Kinoseed is its own container with a proxy to qBittorrent, not a qBittorrent Alternative WebUI. |

## Still open

Nothing right now.
