# Kinoseed

A qBittorrent web UI for movies and TV series. Find a movie or a series, pick a release found by Prowlarr and follow the download, all in one app on your phone or computer.

<p>
  <img src="docs/screenshots/downloads.png" width="200" alt="Downloads with posters, progress and speeds">
  <img src="docs/screenshots/search.png" width="200" alt="Search with trending and popular titles">
  <img src="docs/screenshots/title.png" width="200" alt="A series page with its overview, rating and its download in progress">
  <img src="docs/screenshots/releases.png" width="200" alt="Releases found by Prowlarr with season, quality and voice-over badges">
</p>
<p>
  <img src="docs/screenshots/desktop-downloads.png" width="410" alt="Downloads on a computer: a table with posters, statuses and speeds, and the sidebar">
  <img src="docs/screenshots/desktop-title.png" width="410" alt="A series page on a computer with its releases under the overview">
</p>

## Features

- **Search.** Movies and series from TMDB, picks of what's out on digital and new episodes, a title page with the overview and rating.
- **Releases.** Search across all your Prowlarr indexers. Filter by resolution, source, HDR, audio, seeds and indexer; sort by seeds, size or date.
- **Adding.** Category, save path, file selection (for example, only the seasons you want) and a free space check before the download starts.
- **Downloads.** A live list or poster grid with TMDB posters and titles, statuses, speeds and time left. Pause, resume, delete.
- **Torrent details.** A file tree with priorities, seeds and peers, ratio, trackers.
- **Phone and computer.** On a computer: a sidebar, Downloads as a table or a poster grid, torrent details in a side drawer and a title's releases on its page. Russian and English, dark and light themes; when qBittorrent stops answering, you still see the last known state.

Kinoseed doesn't play video and never downloads anything on its own: you pick every release.

## Install on Umbrel

Kinoseed currently supports umbrelOS only. It needs the **qBittorrent** and **Prowlarr** apps from the Umbrel App Store.

1. Open **App Store** → the **⋯** menu at the top right → **Community App Stores**.
2. Paste `https://github.com/MrShakhov/umbrel-homelab-store` → **Add**.
3. Open **Homelab App Store** → **Kinoseed** → **Install**.
4. Kinoseed opens at `http://umbrel.local:8795`.

On first launch:

- **qBittorrent** connects on its own with Umbrel's default login. If you changed it, Kinoseed asks for the login once and keeps it on your Umbrel.
- **TMDB**: Kinoseed asks for a free [TMDB API key](https://www.themoviedb.org/settings/api). It is kept on your Umbrel too; change it in Settings.
- **Prowlarr** needs no setup: Kinoseed reads its API key itself. Trackers are added as indexers in Prowlarr.

Umbrel offers updates when a new version is out. What changed is in [CHANGELOG.md](CHANGELOG.md).

## On your phone

Kinoseed is a web app (PWA). Over plain HTTP on your home network it works in the browser, and on an iPhone or iPad you can add it to the Home Screen from Safari's Share menu to open it full screen. umbrelOS 2.0 also serves it over HTTPS (`https://umbrel.local:8795`): with the Umbrel certificate trusted on your device ([Umbrel's guide](https://umbrel.com/support/basics/accessing-your-umbrel-over-https)), Kinoseed installs as an app on Android and computers too and keeps its shell available offline.

## Privacy and security

- The TMDB and Prowlarr keys and the qBittorrent login stay on the Kinoseed server and never reach the browser.
- Besides your qBittorrent and Prowlarr, Kinoseed only talks to TMDB, and only through its own server. No analytics, no telemetry.
- Kinoseed never stores tracker logins: that's Prowlarr's job.
- Kinoseed has no login of its own; on Umbrel, Umbrel's login protects it.

## Ideas and bugs

- **An idea or a missing feature:** post it in [Discussions → Ideas](https://github.com/MrShakhov/kinoseed/discussions/categories/ideas), or upvote one that's already there.
- **A bug:** [report it](https://github.com/MrShakhov/kinoseed/issues/new?template=bug_report.yml) with the steps and your versions; Settings → About and Settings → Connections show them.
- **A question about installing or using Kinoseed:** ask in [Discussions → Q&A](https://github.com/MrShakhov/kinoseed/discussions/categories/q-a).

## For developers

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): running locally, server configuration, releases.
- [docs/SPEC.md](docs/SPEC.md): what the product does and why.
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next.

Movie and series data and posters come from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB. The license will be chosen before the public release.
