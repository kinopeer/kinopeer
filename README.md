# Kinoseed

A qBittorrent web UI built around movies and TV series. Metadata comes from [TMDB](https://www.themoviedb.org/).

## Development

Requires Node.js 22.18+ and a qBittorrent instance with the Web UI enabled.

```sh
cp .env.example .env.local   # then set QBITTORRENT_URL to your qBittorrent Web UI
```

The dev server proxies `/qbt/*` to `QBITTORRENT_URL`, so the app and the qBittorrent API share one origin (the same layout the production container will use). The server always holds the qBittorrent login itself and renews the session when it expires; the browser never talks to qBittorrent's auth. `QBITTORRENT_USERNAME` and `QBITTORRENT_PASSWORD` are the default login; if they are missing or wrong, the app asks for one and saves it on the server.

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # tests (Vitest)
npm run lint       # linter (oxlint)
npm run typecheck  # type check
npm run build      # production build into dist/
```

## Production

`npm run build && npm start` runs the production server (`server/main.ts`, plain Node 22.18+ with no dependencies): it serves the built app from `dist/` and the same `/qbt`, `/prowlarr`, `/tmdb` and `/tmdb-img` routes as the dev server, configured through the same environment variables. The TMDB key is entered in the app (onboarding or Settings) and kept by the server in `$KINOSEED_DATA_DIR/settings.json` (default `./data`, `/data` in the image); `TMDB_API_KEY` is only the fallback. `PORT` (default 8080) and `HOST` (default `0.0.0.0`) set where it listens; `/healthz` answers `ok` while it runs.

The Docker image runs the same server:

```sh
docker compose up --build   # builds the image and serves it at http://localhost:8080, settings from .env.local
```

Or without Compose:

```sh
docker build -t kinoseed .
docker run -p 8080:8080 --env-file .env.local -v kinoseed-data:/data kinoseed
```

The service worker needs HTTPS (or `localhost`), so over plain HTTP on the LAN the app works but can't be installed or open offline.
