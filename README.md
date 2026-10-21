# Kinoseed

A qBittorrent web UI built around movies and TV series. Metadata comes from [TMDB](https://www.themoviedb.org/).

## Development

Requires Node.js 22+ and a qBittorrent instance with the Web UI enabled.

```sh
cp .env.example .env.local   # then set QBITTORRENT_URL to your qBittorrent Web UI
```

The dev server proxies `/qbt/*` to `QBITTORRENT_URL`, so the app and the qBittorrent API share one origin (the same layout the production container will use). Set `QBITTORRENT_USERNAME` and `QBITTORRENT_PASSWORD` too if you don't want to sign in from the app: the dev server then logs in to qBittorrent itself and renews the session when it expires.

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # tests (Vitest)
npm run lint       # linter (oxlint)
npm run typecheck  # type check
npm run build      # production build into dist/
```
