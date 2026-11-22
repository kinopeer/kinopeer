/**
 * Whether this is the Alternative WebUI build, which qBittorrent serves itself (`npm run build:webui`),
 * rather than the app Kinopeer's server serves (`npm run build`). Set at build time in vite.config.ts
 * (`buildTarget`), so the other build's branch is dropped from each bundle.
 */
declare const __WEBUI__: boolean

/**
 * Kinopeer's TMDB proxy the WebUI build calls TMDB through without a key of the user's own, as
 * `https://<worker>/3`, or empty for none: what the server image would use (`tmdbProxy` in
 * server/main.ts, from `KINOPEER_TMDB_PROXY` or `TMDB_PROXY_URL` at build time), set in vite.config.ts.
 */
declare const __TMDB_PROXY__: string
