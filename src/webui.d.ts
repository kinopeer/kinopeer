/**
 * Whether this is the Alternative WebUI build, which qBittorrent serves itself (`npm run build:webui`),
 * rather than the app Kinopeer's server serves (`npm run build`). Set at build time in vite.config.ts
 * (`buildTarget`), so the other build's branch is dropped from each bundle.
 */
declare const __WEBUI__: boolean
