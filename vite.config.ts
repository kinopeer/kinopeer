/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import { prowlarrMiddleware, type ProwlarrConfig } from './server/prowlarr.ts'

/**
 * Same-origin proxy to qBittorrent, mirroring the production nginx setup:
 * /qbt/api/v2/... → $QBITTORRENT_URL/api/v2/...
 * Origin and Referer are rewritten to the target so qBittorrent's CSRF check passes.
 */
function qbittorrentProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/qbt/, ''),
    headers: { Origin: target, Referer: target },
  }
}

/** Browser cookies (e.g. the qBittorrent session) must never reach third parties. */
const dropCookies: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (request) => request.removeHeader('cookie'))
}

/**
 * Same-origin proxy to the TMDB API that adds the key server-side, so it never reaches the browser:
 * /tmdb/search/multi?query=... → https://api.themoviedb.org/3/search/multi?query=...&api_key=$TMDB_API_KEY
 * Accepts either a v3 API key or a v4 read access token (a JWT, sent as a bearer token).
 */
function tmdbProxy(key: string): ProxyOptions {
  const isToken = key.startsWith('eyJ')
  return {
    target: 'https://api.themoviedb.org',
    changeOrigin: true,
    rewrite: (path) => {
      const url = path.replace(/^\/tmdb/, '/3')
      return isToken ? url : `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`
    },
    headers: isToken ? { Authorization: `Bearer ${key}` } : undefined,
    configure: dropCookies,
  }
}

/** TMDB images through the same origin: /tmdb-img/w342/abc.jpg → https://image.tmdb.org/t/p/w342/abc.jpg */
const tmdbImageProxy: ProxyOptions = {
  target: 'https://image.tmdb.org',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/tmdb-img/, '/t/p'),
  configure: dropCookies,
}

/** Serves /prowlarr/* from server/prowlarr.ts in `vite` and `vite preview`, as the production server will. */
function prowlarr(config: ProwlarrConfig): Plugin {
  const middleware = prowlarrMiddleware(config)
  return {
    name: 'kinoseed-prowlarr',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy: Record<string, ProxyOptions> = {}
  if (env.QBITTORRENT_URL) proxy['/qbt'] = qbittorrentProxy(env.QBITTORRENT_URL.replace(/\/+$/, ''))
  // Regex keys: a plain '/tmdb' prefix would also catch '/tmdb-img'.
  if (env.TMDB_API_KEY) proxy['^/tmdb/'] = tmdbProxy(env.TMDB_API_KEY.trim())
  proxy['^/tmdb-img/'] = tmdbImageProxy

  return {
    plugins: [react(), prowlarr({ url: env.PROWLARR_URL, apiKey: env.PROWLARR_API_KEY })],
    server: { proxy },
    preview: { proxy },
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'app', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
        },
        { extends: true, test: { name: 'server', include: ['server/**/*.test.ts'], environment: 'node' } },
      ],
    },
  }
})
