# Product spec

What Kinoseed does and why, as of version 0.1.0. Update it in the same PR that changes the behavior; add new decisions to the log at the end.

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
| qBittorrent and Prowlarr addresses | Server environment | The Umbrel package |
| Prowlarr API key | Environment or Prowlarr's `config.xml` | The Umbrel package |
| qBittorrent login | `/data/settings.json`, else environment | The connect screen |
| TMDB key | `/data/settings.json`, else environment | Onboarding or Settings |
| Download defaults (categories, start paused, sequential) | Browser; moving to the server in 0.2 | Settings |
| Theme, interface language, TMDB language | Browser | Settings |
| Torrent-to-TMDB matches | `/data/matches.json`; titles and posters cached in the browser | Guessed automatically; the torrent menu (0.2) |

A torrent's match is forgotten when the torrent is deleted from Kinoseed. For torrents deleted elsewhere, the server checks qBittorrent's list every hour and forgets a match once its torrent has been missing for a week, so a qBittorrent that answers with an empty list after a restart, or a torrent added back, loses nothing.

## Screens

### First launch

1. Kinoseed asks qBittorrent for its version. If the server is already signed in (the package's login or a saved one) or qBittorrent lets the network in without a password, there's no login form.
2. Otherwise, the qBittorrent login form. The server tries a password once and doesn't retry after a rejection: qBittorrent bans the IP for an hour after five failures.
3. The "Connect TMDB" step: a v3 API key or a v4 read access token, checked with TMDB before it's saved. It can be skipped; search then asks for the key later.

### Downloads

- Every qBittorrent torrent, refreshed every 2 seconds while the tab is visible.
- A row shows the TMDB poster and title, status, progress, speed, time left and queue position. The title comes from the user's choice, else the `tmdb:<movie|tv>:<id>` tag, else a guess from the release name. Guesses are saved on the server, so every device shows the same title and each torrent is guessed once.
- A list or a poster grid (status and progress over the poster, percent and speed or size under it). The list is the default; the choice is remembered in the browser.
- Filters by status and name, total speeds, free space.
- Row menu: pause or resume, details, change the title, delete with or without files. When the title was guessed from the release name, the menu asks "Matched by the release name. Is it right?" with Change and "Yes, right" instead of the Change title item.
- Statuses: Downloading (the only one in the accent color), Seeding, Paused, Completed, Queued, Checking, Error.

### Torrent

- Pause, resume, delete; progress, time left, ratio. The More button opens the same menu as the row.
- A guessed title gets the same "Is it right?" card under the heading; when no title was found, "Pick title".
- Changing the title: a TMDB search that starts from the name read from the release, with All, Movies and Series; the current title comes first and is marked. Picking a title, or "Yes, right", saves it on the Kinoseed server as the user's choice, which wins over the tag and any guess.
- Files as a tree, as in the torrent, without regrouping, but without the torrent's single root folder; sorted by name, numbers by value. Priorities: Skip, Normal, High.
- Speeds, seeds and peers, save path, category, date added, info hash, trackers.
- Clear messages for disk errors and missing files.

### Search

Movies and series from TMDB with a type filter. An empty search shows trending this week and popular titles. The query and type live in the page URL.

### Title

Poster, year, runtime or number of seasons and episodes, rating, overview, and a "Find releases" button.

### Releases

- The query is the original title, plus the year for a movie. No category filter: some indexers (RuTor, for example) file everything under "Other".
- Resolution, source, HDR, audio and seasons are read from the release name.
- Filters: resolution, audio, source, minimum seeds, indexer. Sort by seeds, size or date.

### Adding

- Kinoseed gets only the `.torrent` (preferred, so files can be picked) or the magnet link from Prowlarr and adds it to qBittorrent itself. Prowlarr's own download clients aren't used.
- Options: category (the default from Settings, else a qBittorrent category with a matching name such as Movies or TV Shows), save path, start paused, sequential, add to the top of the queue.
- File selection and a free space check. With skipped files, the torrent is added stopped, the skipped files get priority 0, then it starts. A magnet link downloads every file.
- The torrent gets the `tmdb:<movie|tv>:<id>` tag; after adding, the app goes to Downloads and shows a toast.

### Settings

Appearance (theme, language), Connections (checks for qBittorrent, Prowlarr and TMDB, changing the TMDB key), download defaults, the language of TMDB titles and overviews, About (version, clear cache, install). Clearing the cache also forgets the server's guesses, so torrents are matched again; the user's choices stay. Service addresses can't be changed here: the package sets them.

### Offline and errors

- qBittorrent stops answering: the last state stays under a banner with its age, actions are disabled, retries are automatic.
- Before the first answer: a "qBittorrent is unreachable" screen.
- A screen crashes: an error screen with a Reload button.

### App (PWA)

Manifest and icons; the service worker keeps the app shell available offline and caches posters, and never caches qBittorrent, Prowlarr or TMDB data. A new version takes over right away. The service worker needs HTTPS, so it doesn't run over plain HTTP on the home network.

## Decision log

| Date | Decision |
| --- | --- |
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

- **The title as the center.** The title page and the torrent screen stay separate and are linked: under the overview, an "In downloads" block lists this title's torrents (by the same match the downloads list shows), each linking to its torrent screen. This is also how several torrents of one movie or series are seen together. Design it on the canvas first, then build it (0.2).
