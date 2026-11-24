import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, loadEnv, preview, resolveConfig } from 'vite'
import { refusal } from './server/hostCheck.ts'
import { tmdbProxy } from './server/main.ts'
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, WEBUI_CONTENT_SECURITY_POLICY } from './server/securityHeaders.ts'
import { getWithHost } from './server/test/fakes.ts'
import { BaseSequencer, type TestSequencerConstructor, type TestSpecification, type Vitest } from 'vitest/node'
import { KINOPEER_PAGE_MARK } from './src/pwa/swWebui.ts'
import { chunkFileName, inlineTouchIconPlugin, webuiPolicyPlugin } from './vite.config.ts'

/**
 * `npm run dev` and `npm run preview` from this config. loadEnv lets process.env win over
 * .env.local, so stubbing the variables keeps a clone's real services and data out of the test.
 */
let dir: string
const closers: (() => Promise<void>)[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-vite-'))
  for (const name of ['QBITTORRENT_URL', 'QBITTORRENT_USERNAME', 'QBITTORRENT_PASSWORD', 'PROWLARR_URL', 'PROWLARR_API_KEY', 'TMDB_API_KEY', 'KINOPEER_PASSWORD', 'KINOPEER_ALLOWED_HOSTS'])
    vi.stubEnv(name, '')
  // The login on, as by default, whatever a clone's .env.local says: it answers first.
  vi.stubEnv('KINOPEER_AUTH', 'on')
  vi.stubEnv('KINOPEER_DATA_DIR', join(dir, 'data'))
})

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  await rm(dir, { recursive: true, force: true })
})

const options = { configFile: 'vite.config.ts', logLevel: 'silent' } as const
/**
 * Where a server listens: from a random port below the default ephemeral ranges (Linux's starts at 32768,
 * macOS's at 49152), so a socket another test file's worker opens on port 0 is rarely handed it, and with
 * `strictPort` off, so a port taken between Vite's check and its bind moves it to the next one rather than
 * failing the start. Not port 0: there Vite takes an ephemeral port by opening and closing a socket of its
 * own, then listens on it, and throws when another socket got that port in between (#516, seen on CI's Linux).
 */
const listening = () => ({ port: 20_000 + Math.floor(Math.random() * 10_000), host: '127.0.0.1', strictPort: false })

/** `npm run dev` from this config; resolves to its port. `allowedHosts: true` turns Vite's own host check off. */
async function startDev(base?: string, allowedHosts?: true): Promise<number> {
  const server = await createServer({ ...options, base, server: { ...listening(), watch: null, allowedHosts }, optimizeDeps: { noDiscovery: true } })
  closers.push(() => server.close())
  await server.listen()
  return (server.httpServer!.address() as AddressInfo).port
}

/**
 * `npm run preview` from this config, over a build that is only an index.html; resolves to its port.
 * `allowedHosts: true` turns Vite's own host check off.
 */
async function startPreview(allowedHosts?: true): Promise<number> {
  const outDir = join(dir, 'dist')
  await mkdir(outDir)
  await writeFile(join(outDir, 'index.html'), '<!doctype html>')
  const server = await preview({ ...options, build: { outDir }, preview: { ...listening(), allowedHosts } })
  closers.push(() => server.close())
  return (server.httpServer.address() as AddressInfo).port
}

/** A preflight from a page on another localhost port that wants to send /qbt the client's header. */
const preflight = (port: number) =>
  fetch(`http://127.0.0.1:${port}/qbt/api/v2/torrents/delete`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-kinopeer',
    },
  })

describe('vite.config.ts', () => {
  it('answers no cross-origin preflight on the dev server, so another local page can’t send /qbt the header', async () => {
    const answer = await preflight(await startDev())
    expect(answer.headers.has('access-control-allow-origin')).toBe(false)
    expect(answer.ok).toBe(false)
  })

  it('sends the server’s security headers from the dev and preview servers too', async () => {
    for (const [server, port] of [['dev', await startDev()], ['preview', await startPreview()]]) {
      const { headers } = await fetch(`http://127.0.0.1:${port}/`)
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name), `${server} ${name}`).toBe(value)
    }
  })

  // Vite's own allowedHosts refuses such a host first; with it off, the server's check is still there.
  it('runs the server’s host check on the dev and preview servers too', async () => {
    for (const [server, port] of [['dev', await startDev(undefined, true)], ['preview', await startPreview(true)]] as const) {
      const rebound = await getWithHost(`http://127.0.0.1:${port}`, '/', { host: 'rebound.example' })
      expect(rebound.status, server).toBe(403)
      expect(rebound.body, server).toBe(refusal('rebound.example'))
      expect((await getWithHost(`http://127.0.0.1:${port}`, '/', { host: 'umbrel.local' })).status, server).toBe(200)
    }
  })

  // The test stand runs under the Content-Security-Policy; the dev server's pages run Vite's
  // inline scripts, which it would block.
  it('sends the Content-Security-Policy from the preview server and not the dev server', async () => {
    const fromDev = await fetch(`http://127.0.0.1:${await startDev()}/`)
    const fromPreview = await fetch(`http://127.0.0.1:${await startPreview()}/`)
    expect(fromPreview.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(fromDev.headers.has('content-security-policy')).toBe(false)
  })

  // What keeps a port taken by another test file's worker from failing a start (#516).
  it('starts the dev server on the next port when the one it starts from is taken', async () => {
    // A port from the same range, not port 0, which may hand out 65535 and leave Vite no port after it.
    const taken = createNetServer()
    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          taken.once('error', reject)
          taken.listen(listening().port, '127.0.0.1', () => {
            taken.off('error', reject)
            resolve()
          })
        })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      }
    }
    closers.push(() => new Promise<void>((resolve) => taken.close(() => resolve())))
    const port = (taken.address() as AddressInfo).port
    const server = await createServer({ ...options, server: { ...listening(), port, watch: null }, optimizeDeps: { noDiscovery: true } })
    closers.push(() => server.close())
    await server.listen()
    const moved = (server.httpServer!.address() as AddressInfo).port
    expect(moved).not.toBe(port)
    expect((await fetch(`http://127.0.0.1:${moved}/`)).status).toBe(200)
  })

  // The data directory (./data by default) sits under the root the dev server serves files from, and
  // `dev-lan` serves that to the whole LAN: the saved keys, the qBittorrent login, the password's hash (#476).
  it('serves nothing from the data directory on the dev server, by any of the ways Vite serves a file', async () => {
    // The checkout reached through a link, as Vite takes its root by its real path, and that real
    // path with a glob's characters, which the list has to match as they are.
    const real = join(dir, 'Dev (old) [1]')
    const root = join(dir, 'checkout')
    await mkdir(real)
    await symlink(real, root)
    const data = join(root, 'data')
    vi.stubEnv('KINOPEER_DATA_DIR', data)
    const server = await createServer({ ...options, root, server: { ...listening(), watch: null }, optimizeDeps: { noDiscovery: true } })
    closers.push(() => server.close())
    await server.listen()
    // Made after the server starts, as ./data often is: the first save makes it.
    await mkdir(data)
    await writeFile(join(data, 'settings.json'), '{"secret":"x"}')
    const port = (server.httpServer!.address() as AddressInfo).port
    for (const path of ['/data/settings.json', '/data/settings.json?raw', '/data/settings.json?import', '/data/settings.json?url', `/@fs${await realpath(data)}/settings.json`]) {
      const answer = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(await answer.text(), path).not.toContain('secret')
    }
  })

  // The dev server's list takes the place of Vite's own, which keeps .env.local and the keys and certificates out.
  it('keeps every file Vite refuses by default refused on the dev server', async () => {
    const [ours, vites] = await Promise.all([resolveConfig({ ...options }, 'serve'), resolveConfig({ configFile: false, logLevel: 'silent' }, 'serve')])
    expect(ours.server.fs.deny).toEqual(expect.arrayContaining(vites.server.fs.deny))
  })

  // The WebUI build (#360) branches on __WEBUI__, which the server's build has false, so its code is dropped there.
  // qBittorrent serves an Alternative WebUI from the `public/` folder under the one its settings name.
  // The modes are the ones package.json's scripts pass, so a script that names another builds no WebUI.
  it('builds the server’s app into dist/ and the WebUI into dist-webui/public/, each with its own __WEBUI__', async () => {
    const { scripts } = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
    const modeOf = (script: string) => /--mode (\S+)/.exec(scripts[script])?.[1] ?? 'production'
    const [server, webui] = await Promise.all([resolveConfig(options, 'build', modeOf('build')), resolveConfig(options, 'build', modeOf('build:webui'))])
    expect([server.build.outDir, server.define?.__WEBUI__]).toStrictEqual(['dist', 'false'])
    expect([webui.build.outDir, webui.define?.__WEBUI__]).toStrictEqual(['dist-webui/public', 'true'])
  })

  // The WebUI build calls Kinopeer's TMDB proxy from the page, so the build bakes in the one the image would use.
  // Where a case doesn't set TMDB_PROXY_URL, which wins over a .env.local's, it compares with what tmdbProxy makes of
  // the build's environment, .env files included: the release worker wherever none names a proxy, as in CI.
  it('gives the build the TMDB proxy the image would use: the release worker unless the environment names another', async () => {
    const proxyOf = async () => (await resolveConfig(options, 'build', 'webui')).define?.__TMDB_PROXY__
    const asTheImage = () => JSON.stringify(tmdbProxy(loadEnv('webui', process.cwd(), '')) ?? '')
    vi.stubEnv('TMDB_PROXY_URL', undefined)
    vi.stubEnv('KINOPEER_TMDB_PROXY', undefined)
    expect(await proxyOf()).toBe(asTheImage())
    vi.stubEnv('KINOPEER_TMDB_PROXY', 'https://built-for.example.test/3')
    expect(await proxyOf()).toBe(asTheImage())
    vi.stubEnv('TMDB_PROXY_URL', 'https://proxy.example.test/3')
    expect(await proxyOf()).toBe(JSON.stringify('https://proxy.example.test/3'))
    // An empty TMDB_PROXY_URL turns the proxy off, as for the image.
    vi.stubEnv('TMDB_PROXY_URL', '')
    expect(await proxyOf()).toBe('""')
  })

  // qBittorrent serves the WebUI with no policy but frame-ancestors; Kinopeer's server sends its own as a header.
  // qBittorrent sends an Alternative WebUI no Referrer-Policy either: a link out would tell the site the page's address.
  it('puts the WebUI’s Content-Security-Policy and Referrer-Policy into the WebUI build’s index.html only', async () => {
    const policyIn = async (mode: string) => (await resolveConfig(options, 'build', mode)).plugins.some(({ name }) => name === 'kinopeer-webui-policy')
    expect([await policyIn('production'), await policyIn('webui')]).toStrictEqual([false, true])
    const transform = webuiPolicyPlugin().transformIndexHtml as () => unknown
    expect(transform()).toStrictEqual([
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: WEBUI_CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'same-origin' }, injectTo: 'head-prepend' },
    ])
    expect(webuiPolicyPlugin().apply).toBe('build')
  })

  it('answers no cross-origin preflight on the preview server either', async () => {
    const answer = await preflight(await startPreview())
    expect(answer.headers.has('access-control-allow-origin')).toBe(false)
    expect(answer.ok).toBe(false)
  })

  // iOS fetches a linked touch icon in a process of its own, which got nothing behind Umbrel's HTTPS (#304).
  it('puts the touch icon into index.html as a data: URL of the PNG in public/', async () => {
    const page = await (await fetch(`http://127.0.0.1:${await startDev()}/`)).text()
    const href = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(page)?.[1]
    const png = await readFile('public/icons/apple-touch-icon.png')
    expect(href).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  // The WebUI's service worker forgets itself when a page hasn't it: qBittorrent's own interface took Kinopeer's place.
  it('keeps the mark that tells the WebUI’s service worker the page is Kinopeer’s', async () => {
    const page = await (await fetch(`http://127.0.0.1:${await startDev()}/`)).text()
    expect(page).toContain(KINOPEER_PAGE_MARK)
  })

  // Vite prefixes public paths with the base when it processes the HTML; the icon is read before that.
  it('inlines the touch icon under a base too', async () => {
    const page = await (await fetch(`http://127.0.0.1:${await startDev('/sub/')}/sub/`)).text()
    expect(/<link rel="apple-touch-icon" href="([^"]+)"/.exec(page)?.[1]).toMatch(/^data:image\/png;base64,/)
  })

  const transform = (html: string) => (inlineTouchIconPlugin().transformIndexHtml as { handler: (html: string) => string }).handler(html)

  it('fails the build when index.html has no touch icon link to inline, rather than leaving the tile generic', () => {
    expect(() => transform('<link rel="icon" href="/favicon.svg" />')).toThrow('no <link rel="apple-touch-icon"')
  })

  it('fails the build on a touch icon other than a PNG, which the data: URL would name wrong', () => {
    expect(() => transform('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.webp" />')).toThrow('inlined as a PNG, not /icons/apple-touch-icon.webp')
  })
})

describe('chunkFileName', () => {
  const locales = fileURLToPath(new URL('./src/i18n/locales', import.meta.url))

  it("names a language's texts so the size budget tells them apart", () => {
    expect(chunkFileName({ facadeModuleId: join(locales, 'ru.json') })).toBe('assets/language-[name]-[hash].js')
  })

  it.each([
    ['a module elsewhere', fileURLToPath(new URL('./src/main.tsx', import.meta.url))],
    ['a folder that only starts like the locales', `${locales}-old/ru.json`],
    ['no module', null],
  ])('names a chunk of %s as Vite does', (_what, facadeModuleId) => {
    expect(chunkFileName({ facadeModuleId })).toBe('assets/[name]-[hash].js')
  })
})

describe('RelatedFilesFirst', () => {
  /** Files of three sizes, so Vitest's own order, larger first while it has no results, is known. */
  async function specs(): Promise<TestSpecification[]> {
    const project = { name: 'server', config: { sequence: { groupOrder: 0 }, isolate: true } }
    const sizes = { 'big.test.ts': 300, 'container.test.ts': 100, 'mid.test.ts': 200 }
    return Promise.all(
      Object.entries(sizes).map(async ([name, size]) => {
        const moduleId = join(dir, name)
        await writeFile(moduleId, 'x'.repeat(size))
        return { moduleId, project } as unknown as TestSpecification
      }),
    )
  }

  /** What a sequencer reads of Vitest: a run related to `related`, cut into `shard`, with no results kept. */
  const context = (related?: string[], shard?: { index: number; count: number }) =>
    ({ config: { related, shard, root: dir }, cache: { getTestSpecificationResult: () => undefined } }) as unknown as Vitest

  /** The sequencer this config gives Vitest, as `vitest` resolves it, over `context`'s run. */
  async function sequencer(related?: string[], shard?: { index: number; count: number }) {
    const config = (await resolveConfig(options, 'serve', 'test')) as { test?: { sequence?: { sequencer?: TestSequencerConstructor } } }
    const Sequencer = config.test?.sequence?.sequencer
    if (!Sequencer) throw new Error('vite.config.ts gives Vitest no sequencer')
    return new Sequencer(context(related, shard))
  }
  const names = (files: TestSpecification[]) => files.map((spec) => spec.moduleId.slice(dir.length + 1))

  it("runs the tests named after a related file first, the rest in Vitest's order", async () => {
    expect(names(await (await sequencer(['/sandbox/server/container.ts'])).sort(await specs()))).toStrictEqual(['container.test.ts', 'big.test.ts', 'mid.test.ts'])
  })

  it("keeps Vitest's order in a run of every test", async () => {
    expect(names(await (await sequencer()).sort(await specs()))).toStrictEqual(['big.test.ts', 'mid.test.ts', 'container.test.ts'])
  })

  it.each([1, 2])("shards as Vitest does: shard %i of 2 holds the files Vitest's own sequencer puts there", async (index) => {
    const files = await specs()
    const shard = { index, count: 2 }
    expect(names(await (await sequencer(undefined, shard)).shard(files))).toStrictEqual(names(await new BaseSequencer(context(undefined, shard)).shard(files)))
  })
})
