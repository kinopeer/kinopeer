/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { serverRoutes } from './server/main.ts'
import type { Middleware } from './server/prowlarr.ts'
import { SettingsStore } from './server/settings.ts'

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
 * Serves server/ middleware (/api/settings, /qbt/*, /prowlarr/*, /tmdb/* and /tmdb-img/*) in `vite` and
 * `vite preview`, as the production server (server/main.ts) does.
 */
function serverRoutesPlugin(middlewares: Middleware[]): Plugin {
  return {
    name: 'kinoseed-server',
    configureServer: (server) => middlewares.forEach((middleware) => server.middlewares.use(middleware)),
    configurePreviewServer: (server) => middlewares.forEach((middleware) => server.middlewares.use(middleware)),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const store = new SettingsStore(resolve(env.KINOSEED_DATA_DIR || 'data'))
  void store.load()

  return {
    plugins: [
      react(),
      pwa,
      serverRoutesPlugin(serverRoutes(env, store)),
    ],
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
