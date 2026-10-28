/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { dataStores, kinoseedServer, type KinoseedServer } from './server/main.ts'

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
 * Serves server/ middleware (/api/settings, /api/matches, /qbt/*, /prowlarr/*, /tmdb/* and
 * /tmdb-img/*) and runs its jobs in `vite` and `vite preview`, as the production server
 * (server/main.ts) does. Nothing runs in `vite build`.
 */
function serverRoutesPlugin(kinoseed: KinoseedServer): Plugin {
  const serve = (server: { middlewares: { use: (middleware: KinoseedServer['routes'][number]) => unknown }; httpServer: { once: (event: 'close', listener: () => void) => unknown } | null }) => {
    kinoseed.routes.forEach((middleware) => server.middlewares.use(middleware))
    const stopJobs = kinoseed.startJobs()
    server.httpServer?.once('close', stopJobs)
  }
  return { name: 'kinoseed-server', configureServer: serve, configurePreviewServer: serve }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const stores = dataStores(resolve(env.KINOSEED_DATA_DIR || 'data'))
  void stores.settings.load()

  return {
    // Shown in Settings → About (src/version.d.ts).
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [
      react(),
      pwa,
      serverRoutesPlugin(kinoseedServer(env, stores)),
    ],
    test: {
      // One time zone everywhere, so a test that reads local time passes on the owner's Mac (UTC+1)
      // and in CI alike; a test about another zone sets it in the test.
      env: { TZ: 'UTC' },
      projects: [
        {
          extends: true,
          test: { name: 'app', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
        },
        { extends: true, test: { name: 'server', include: ['server/**/*.test.ts'], environment: 'node' } },
      ],
      // `npm run test:coverage`: a table in the terminal and coverage/index.html; CI runs the same.
      // Test helpers, type-only modules and the barrels that only re-export (src/i18n/index.ts sets
      // i18next up, so it counts) are left out, since they have no behavior to cover. The thresholds
      // are a ratchet (docs/TESTING.md → Coverage): two points under the totals when they were set,
      // raised when the totals grow and stay there, never lowered to get a PR through.
      coverage: {
        provider: 'v8',
        include: ['src/**', 'server/**'],
        exclude: [
          '**/*.test.{ts,tsx}',
          'src/test/**',
          'src/test-setup.ts',
          'server/test/**',
          '**/*.d.ts',
          '**/types.ts',
          'src/api/*/index.ts',
          'src/components/*/index.ts',
        ],
        reporter: ['text', 'html'],
        thresholds: { lines: 94, statements: 92, functions: 91, branches: 90 },
      },
    },
  }
})
