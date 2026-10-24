# Kinoseed

A qBittorrent web UI for movies and TV series. Find a movie or a series, pick a release found by Prowlarr and follow the download, all in one app on your phone or computer.

<p>
  <img src="docs/screenshots/downloads.png" width="200" alt="Downloads with posters, progress and speeds">
  <img src="docs/screenshots/search.png" width="200" alt="Search with trending and popular titles">
  <img src="docs/screenshots/title.png" width="200" alt="A movie page with its overview and rating">
  <img src="docs/screenshots/releases.png" width="200" alt="Releases found by Prowlarr with quality badges">
</p>

## Features

- **Search.** Movies and series from TMDB, trending and popular picks, a title page with the overview and rating.
- **Releases.** Search across all your Prowlarr indexers. Filter by resolution, source, HDR, audio, seeds and indexer; sort by seeds, size or date.
- **Adding.** Category, save path, file selection (for example, only the seasons you want) and a free space check before the download starts.
- **Downloads.** A live list with TMDB posters and titles, statuses, speeds and time left. Pause, resume, delete.
- **Torrent details.** A file tree with priorities, seeds and peers, ratio, trackers.
- **Made for the phone.** Russian and English, dark and light themes; when qBittorrent stops answering, you still see the last known state.

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

Kinoseed is a web app (PWA). Over plain HTTP on your home network it works in the browser. Installing it to the home screen with offline support needs HTTPS, which is on the [roadmap](docs/ROADMAP.md).

## Privacy and security

- The TMDB and Prowlarr keys and the qBittorrent login stay on the Kinoseed server and never reach the browser.
- Besides your qBittorrent and Prowlarr, Kinoseed only talks to TMDB, and only through its own server. No analytics, no telemetry.
- Kinoseed never stores tracker logins: that's Prowlarr's job.
- Kinoseed has no login of its own; on Umbrel, Umbrel's login protects it.

## For developers

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): running locally, server configuration, releases.
- [docs/SPEC.md](docs/SPEC.md): what the product does and why.
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next.

Movie and series data and posters come from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB. The license will be chosen before the public release.
