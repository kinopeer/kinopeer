/// <reference types="vitest/config" />
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, normalizePath, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { TMDB_PROXY_EDGE, dataStores, kinopeerServer, loadStores, type KinopeerServer } from './server/main.ts'
import { contentSecurityPolicy } from './server/securityHeaders.ts'
import type { TestSequencer, TestSpecification, Vitest } from 'vitest/node'
import { relatedFilesFirst } from './scripts/test-order/testOrder.ts'

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

/** Where the interface's texts are, one file per language (src/i18n/locales/). */
const LOCALES = normalizePath(fileURLToPath(new URL('./src/i18n/locales', import.meta.url)))

/**
 * A built chunk's file name. A language's texts, loaded on their own when the page shows that
 * language (`showLanguage` in src/i18n/language.ts, #492), are named `language-<code>-<hash>.js`,
 * so the size budget counts only the heaviest of them, the one a page may load
 * (scripts/size/budget.ts); the app has no other lazy chunk.
 */
export function chunkFileName({ facadeModuleId }: { facadeModuleId: string | null }): string {
  return facadeModuleId !== null && normalizePath(facadeModuleId).startsWith(`${LOCALES}/`) ? 'assets/language-[name]-[hash].js' : 'assets/[name]-[hash].js'
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

/**
 * What Vite's dev server refuses to serve by default (`server.fs.deny`), which a list of our own
 * replaces rather than extends: .env.local, keys and certificates, .git. vite.config.test.ts checks
 * it still holds all of Vite's own after an upgrade.
 */
const VITE_DENIED = ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**']

/** A path as a glob that matches only itself and what's under it, whatever characters it has. */
const everythingUnder = (dir: string) => `${normalizePath(dir).replace(/[\\*?[\]{}()!+@|^$]/g, '\\$&')}/**`

/**
 * A path with its symlinks resolved, as Vite resolves the root it serves files from, so a checkout
 * reached through a link (or macOS's /var, which is /private/var) is matched too. The folder needn't
 * exist yet: the part that does is resolved.
 */
function realPath(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : join(realPath(parent), basename(path))
}

/**
 * Vitest's own order with the tests named after the files a run is related to first
 * (`scripts/test-order/testOrder.ts`, #520), so a static mutant in Stryker's run stops at its file's
 * own test rather than after most of the suite. A run of every test has nothing related and keeps
 * Vitest's order. The tests moved to the front leave Vitest's grouping by project, on purpose: in a
 * parallel `vitest related` the app's and the server's among them interleave, which changes no
 * outcome, and Stryker's runs use one worker. Vitest is imported when it sorts, so `vite` and
 * `vite build` don't load it.
 */
class RelatedFilesFirst implements TestSequencer {
  private readonly ctx: Vitest

  constructor(ctx: Vitest) {
    this.ctx = ctx
  }

  private async base() {
    const { BaseSequencer } = await import('vitest/node')
    return new BaseSequencer(this.ctx)
  }

  async shard(files: TestSpecification[]) {
    return (await this.base()).shard(files)
  }

  async sort(files: TestSpecification[]) {
    const sorted = await (await this.base()).sort(files)
    return relatedFilesFirst(sorted, this.ctx.config.related ?? [], (spec) => spec.moduleId)
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dataDir = resolve(env.KINOPEER_DATA_DIR || 'data')
  const stores = dataStores(dataDir)
  const appVersion = env.KINOPEER_COMMIT ? `${version}+${env.KINOPEER_COMMIT}` : version
  void loadStores(stores)

  return {
    // Shown in Settings → About (src/version.d.ts). Edge builds of main (.github/workflows/edge.yml)
    // pass the commit, so the version says which one is running: 0.6.0+abc1234.
    // The WebUI build (`--mode webui`, src/version.d.ts) is the one qBittorrent serves itself.
    define: { __APP_VERSION__: JSON.stringify(appVersion), __WEBUI__: JSON.stringify(mode === 'webui') },
    // Vite answers CORS preflights from any localhost origin before server/ middleware runs, which
    // would let a page on another local port send /qbt the X-Kinopeer header (server/qbittorrent.ts).
    // The app calls only its own origin. `vite preview` takes this too (vite.config.test.ts).
    // The data directory (./data by default) is under the root the dev server serves any file from,
    // and holds the saved keys, the qBittorrent login and the password's hash; `dev-lan` serves the
    // LAN (#476). The list covers the root, /@fs/ and imports such as ?raw alike.
    server: { cors: false, fs: { deny: [...VITE_DENIED, ...new Set([dataDir, realPath(dataDir)].map(everythingUnder))] } },
    // Each language's texts in a chunk of their own, named for the size budget (chunkFileName, above).
    build: { rolldownOptions: { output: { chunkFileNames: chunkFileName } } },
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
      sequence: { sequencer: RelatedFilesFirst },
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
          test: { name: 'server', include: ['server/**/*.test.ts', 'tmdb-proxy/**/*.test.ts', 'scripts/guard/**/*.test.ts', 'scripts/size/**/*.test.ts', 'scripts/requests/**/*.test.ts', 'scripts/layout-shift/**/*.test.ts', 'scripts/accessibility/**/*.test.ts', 'scripts/actuals/**/*.test.ts', 'scripts/edge/**/*.test.ts', 'scripts/test-order/**/*.test.ts', 'vite.config.test.ts', 'checks.test.ts', 'docker-compose.test.ts', 'unraid/**/*.test.ts'], environment: 'node' },
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
      // The report is written when a test fails too (Vitest doesn't by default), so CI's job summary
      // and the actual values still have what a red run covered (docs/QUALITY.md → The actual values).
      coverage: { provider: 'v8', ...checks.coverage, reporter: ['text', 'html'], reportOnFailure: true },
    },
  }
})
