/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { TMDB_PROXY_EDGE, dataStores, kinopeerServer, type KinopeerServer } from './server/main.ts'
import { contentSecurityPolicy } from './server/securityHeaders.ts'

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
 * (server/main.ts) does. `vite preview` also sends the Content-Security-Policy, so the test stand
 * runs under it; the dev server doesn't, since its pages run Vite's inline scripts. Nothing runs
 * in `vite build`.
 */
function serverRoutesPlugin(kinopeer: KinopeerServer): Plugin {
  type Middleware = KinopeerServer['routes'][number]
  const serve =
    (first: Middleware[]) =>
    (server: { middlewares: { use: (middleware: Middleware) => unknown }; httpServer: { once: (event: 'close', listener: () => void) => unknown } | null }) => {
      ;[...first, ...kinopeer.routes].forEach((middleware) => server.middlewares.use(middleware))
      const stopJobs = kinopeer.startJobs()
      server.httpServer?.once('close', stopJobs)
    }
  return { name: 'kinopeer-server', configureServer: serve([]), configurePreviewServer: serve([contentSecurityPolicy]) }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * What the coverage run measures and the thresholds it fails under. They sit in checks.json, as
 * data, so the checks guard (scripts/guard/) can compare them with main's exactly and mark a PR that
 * lowers a threshold or leaves more out.
 */
const checks = JSON.parse(readFileSync(new URL('./checks.json', import.meta.url), 'utf8')) as {
  coverage: { include: string[]; exclude: string[]; thresholds: Record<'lines' | 'statements' | 'functions' | 'branches', number> }
}

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

/**
 * Puts the touch icon into index.html as a `data:` URL, so iOS takes it from the page for Add to Home
 * Screen and fetches nothing. iOS fetches that icon in a process of its own, which got nothing over
 * Umbrel's HTTPS (its certificate trusted in Safari only through a per-site exception), so the Home
 * Screen showed a generic tile (#304). index.html's `<link>` stays the source: the file it names in
 * public/ (rendered by scripts/render-icons.mjs) is read and inlined, in dev and in the build, before
 * Vite's own HTML processing (`order: 'pre'`), which would prefix the path with a `base`. A PNG
 * only, since that's the type the `data:` URL names. The Content-Security-Policy allows `data:`
 * images (server/securityHeaders.ts).
 */
export function inlineTouchIconPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'kinopeer-inline-touch-icon',
    configResolved(config) {
      publicDir = config.publicDir
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const link = /(<link rel="apple-touch-icon" href=")([^"]+)"/.exec(html)
        if (!link) throw new Error('index.html has no <link rel="apple-touch-icon" href="…"> to inline')
        if (!link[2].endsWith('.png')) throw new Error(`The touch icon is inlined as a PNG, not ${link[2]}`)
        const icon = readFileSync(join(publicDir, link[2])).toString('base64')
        return html.replace(link[0], `${link[1]}data:image/png;base64,${icon}"`)
      },
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
      inlineTouchIconPlugin(),
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
        {
          extends: true,
          test: { name: 'server', include: ['server/**/*.test.ts', 'tmdb-proxy/**/*.test.ts', 'scripts/guard/**/*.test.ts', 'scripts/size/**/*.test.ts', 'vite.config.test.ts'], environment: 'node' },
        },
      ],
      // `npm run test:coverage`: a table in the terminal and coverage/index.html; CI runs the same.
      // What is measured and the thresholds come from checks.json (above). Only the code is
      // measured: a pattern without an extension also takes in config and data files, which v8
      // can't parse as JavaScript (tmdb-proxy/wrangler.jsonc, #283) or counts as uncovered lines
      // (tmdb-proxy/package.json). Test helpers, type-only modules and the barrels that only
      // re-export (src/i18n/index.ts sets i18next up, so it counts) are left out, since they have
      // no behavior to cover. The thresholds are a ratchet (docs/TESTING.md → Coverage): two points
      // under the totals when they were set, raised when the totals grow and stay there, never
      // lowered to get a PR through.
      coverage: { provider: 'v8', ...checks.coverage, reporter: ['text', 'html'] },
    },
  }
})
