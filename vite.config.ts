/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { TMDB_PROXY_EDGE, dataStores, kinopeerServer, type KinopeerServer } from './server/main.ts'

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
    name: 'Kinopeer',
    short_name: 'Kinopeer',
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
function serverRoutesPlugin(kinopeer: KinopeerServer): Plugin {
  const serve = (server: { middlewares: { use: (middleware: KinopeerServer['routes'][number]) => unknown }; httpServer: { once: (event: 'close', listener: () => void) => unknown } | null }) => {
    kinopeer.routes.forEach((middleware) => server.middlewares.use(middleware))
    const stopJobs = kinopeer.startJobs()
    server.httpServer?.once('close', stopJobs)
  }
  return { name: 'kinopeer-server', configureServer: serve, configurePreviewServer: serve }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Writes version.json next to index.html with the version the bundle has, which an open app compares
 * with its own to reload into a new one (src/pwa/updates.ts). A static file, so it needs no server;
 * the service worker doesn't precache it (no .json in globPatterns) and server/static.ts revalidates it.
 */
function versionFilePlugin(appVersion: string): Plugin {
  return {
    name: 'kinopeer-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const stores = dataStores(resolve(env.KINOPEER_DATA_DIR || 'data'))
  const appVersion = env.KINOPEER_COMMIT ? `${version}+${env.KINOPEER_COMMIT}` : version
  void stores.settings.load()

  return {
    // Shown in Settings → About (src/version.d.ts). Edge builds of main (.github/workflows/edge.yml)
    // pass the commit, so the version says which one is running: 0.6.0+abc1234.
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    // Vite answers CORS preflights from any localhost origin before server/ middleware runs, which
    // would let a page on another local port send /qbt the X-Kinopeer header (server/qbittorrent.ts).
    // The app calls only its own origin. `vite preview` takes this too (vite.config.test.ts).
    server: { cors: false },
    plugins: [
      react(),
      pwa,
      versionFilePlugin(appVersion),
      // A checkout runs main's code, which only the edge worker of the TMDB proxy keeps up with: the
      // release worker gets a new path at the release (docs/DEVELOPMENT.md → The TMDB proxy).
      serverRoutesPlugin(kinopeerServer({ KINOPEER_TMDB_PROXY: TMDB_PROXY_EDGE, ...env }, stores)),
    ],
    test: {
      // One time zone everywhere, so a test that reads local time passes in any machine's local
      // zone and in CI alike; a test about another zone stubs it (docs/TESTING.md → A test that can fail).
      env: { TZ: 'UTC' },
      // Before each test, put back every vi.spyOn spy, vi.stubGlobal and vi.stubEnv, so a test that
      // fails halfway leaves none of them to the tests after it (docs/TESTING.md → A test that can fail).
      restoreMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
      projects: [
        {
          extends: true,
          test: { name: 'app', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
        },
        { extends: true, test: { name: 'server', include: ['server/**/*.test.ts', 'tmdb-proxy/**/*.test.ts', 'vite.config.test.ts'], environment: 'node' } },
      ],
      // `npm run test:coverage`: a table in the terminal and coverage/index.html; CI runs the same.
      // Test helpers, type-only modules and the barrels that only re-export (src/i18n/index.ts sets
      // i18next up, so it counts) are left out, since they have no behavior to cover. The thresholds
      // are a ratchet (docs/TESTING.md → Coverage): two points under the totals when they were set,
      // raised when the totals grow and stay there, never lowered to get a PR through.
      coverage: {
        provider: 'v8',
        include: ['src/**', 'server/**', 'tmdb-proxy/**'],
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
        thresholds: { lines: 96, statements: 94, functions: 95, branches: 93 },
      },
    },
  }
})
