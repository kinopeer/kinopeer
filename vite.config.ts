/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { prowlarrMiddleware, type Middleware } from './server/prowlarr.ts'
import { qbittorrentMiddleware } from './server/qbittorrent.ts'

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

/**
 * The PWA: web app manifest and a service worker (src/sw.ts) that precaches the app shell. Icons
 * come from scripts/render-icons.mjs. The service worker is off in `vite` dev; try it with
 * `npm run build && npm run preview`.
 */
const pwa = VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectRegister: 'script-defer',
  manifest: {
    id: '/',
    name: 'Kinoseed',
    short_name: 'Kinoseed',
    description: 'Find movies and series, pick a release and download it with qBittorrent.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    // --bg of the dark theme, the primary one (src/styles/tokens.css).
    background_color: '#0e1113',
    theme_color: '#0e1113',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
    ],
  },
  injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,svg,png}'] },
})

/**
 * Serves server/ middleware (/qbt/* and /prowlarr/*) in `vite` and `vite preview`, as the
 * production server will.
 */
function serverRoutes(middlewares: Middleware[]): Plugin {
  return {
    name: 'kinoseed-server',
    configureServer: (server) => middlewares.forEach((middleware) => server.middlewares.use(middleware)),
    configurePreviewServer: (server) => middlewares.forEach((middleware) => server.middlewares.use(middleware)),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy: Record<string, ProxyOptions> = {}
  // Regex keys: a plain '/tmdb' prefix would also catch '/tmdb-img'.
  if (env.TMDB_API_KEY) proxy['^/tmdb/'] = tmdbProxy(env.TMDB_API_KEY.trim())
  proxy['^/tmdb-img/'] = tmdbImageProxy

  return {
    plugins: [
      react(),
      pwa,
      serverRoutes([
        qbittorrentMiddleware({
          url: env.QBITTORRENT_URL,
          username: env.QBITTORRENT_USERNAME,
          password: env.QBITTORRENT_PASSWORD,
        }),
        prowlarrMiddleware({ url: env.PROWLARR_URL, apiKey: env.PROWLARR_API_KEY }),
      ]),
    ],
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
