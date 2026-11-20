import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { TMDB_PROXY, TMDB_PROXY_EDGE, createApp, dataStores, ignoredSettings, kinopeerServer, loadStores, loginWarning, missingSettings, tmdbProxy } from './main.ts'
import { refusal } from './hostCheck.ts'
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from './securityHeaders.ts'
import { SettingsStore } from './settings.ts'
import { TELEGRAM_TOKEN, closeServers, fakeProwlarr, fakePushService, fakeQbittorrent, fakeTelegram, fakeTmdb, getWithHost } from './test/fakes.ts'
import { TORRENTS } from '../src/test/fixtures.ts'

let root: string
let server: Server
let app: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kinopeer-main-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Kinopeer</title>')
  // The proxy off, so nothing here calls the real one, and the login off, as on Umbrel; its own
  // tests below turn it on.
  server = createApp(root, kinopeerServer({ TMDB_PROXY_URL: '', KINOPEER_AUTH: 'off' }, dataStores(join(root, 'data'))))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  app = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

describe('createApp', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${app}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('routes the bridges before the app, and says what is not configured', async () => {
    expect((await fetch(`${app}/qbt/api/v2/app/version`)).status).toBe(503)
    expect(await (await fetch(`${app}/prowlarr/status`)).json()).toEqual({ error: 'not-configured' })
    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(401)
    expect(await (await fetch(`${app}/api/settings`)).json()).toEqual({
      tmdb: { configured: false, source: null, fallback: null },
      prowlarr: { configured: false, source: null, serverKey: false, address: { source: null } },
      qbittorrent: { configured: false, source: null, address: { source: null } },
      downloads: null,
      auth: { enabled: false },
      telegram: { bot: null, chat: null, refused: null },
      push: { devices: 0 },
      notifications: false,
    })
    expect(await (await fetch(`${app}/api/matches`)).json()).toEqual({})
  })

  it('holds every route of the server behind the login, but the app, its version and the health check', async () => {
    const data = join(root, 'login-on')
    const guarded = createApp(root, kinopeerServer({ TMDB_PROXY_URL: '' }, dataStores(data)))
    await new Promise<void>((resolve) => guarded.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(guarded.address() as AddressInfo).port}`
    await writeFile(join(root, 'version.json'), '{"version":"1.0.0"}')
    try {
      for (const path of ['/qbt/api/v2/app/version', '/prowlarr/status', '/tmdb/movie/771', '/tmdb-img/w342/a.jpg', '/api/settings', '/api/matches']) {
        const response = await fetch(`${base}${path}`)
        expect(response.status, path).toBe(401)
        expect(response.headers.get('x-kinopeer-auth'), path).toBe('set-up')
        expect(response.headers.get('content-security-policy'), path).toBe(CONTENT_SECURITY_POLICY)
      }
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
      expect(await (await fetch(`${base}/settings`)).text()).toContain('Kinopeer')
      expect(await (await fetch(`${base}/version.json`)).json()).toEqual({ version: '1.0.0' })
    } finally {
      await new Promise((resolve) => guarded.close(resolve))
      await rm(join(root, 'version.json'))
    }
  })

  it('sends the security headers with every answer, the app’s, the bridges’ and a 404', async () => {
    for (const path of ['/healthz', '/qbt/api/v2/app/version', '/api/settings', '/settings', '/assets/missing.js']) {
      const { headers } = await fetch(`${app}${path}`)
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name), `${path} ${name}`).toBe(value)
      expect(headers.get('content-security-policy'), path).toBe(CONTENT_SECURITY_POLICY)
    }
  })

  it('answers a page rebound to its address with nothing but the refusal, its headers included', async () => {
    for (const path of ['/', '/settings', '/healthz', '/qbt/api/v2/app/version', '/api/settings', '/prowlarr/status', '/tmdb/movie/771']) {
      const response = await getWithHost(app, path, { host: 'rebound.example:8080' })
      expect(response.status, path).toBe(403)
      expect(response.body, path).toBe(refusal('rebound.example'))
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers[name.toLowerCase()], `${path} ${name}`).toBe(value)
      expect(response.headers['content-security-policy'], path).toBe(CONTENT_SECURITY_POLICY)
    }
    expect((await getWithHost(app, '/healthz', { host: 'umbrel.local:8797' })).body).toBe('ok')
  })

  it('answers at the hosts KINOPEER_ALLOWED_HOSTS adds', async () => {
    const allowing = createApp(root, kinopeerServer({ TMDB_PROXY_URL: '', KINOPEER_ALLOWED_HOSTS: 'kinopeer.example.com' }, dataStores(join(root, 'data'))))
    await new Promise<void>((resolve) => allowing.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(allowing.address() as AddressInfo).port}`
      expect((await getWithHost(base, '/healthz', { host: 'kinopeer.example.com' })).body).toBe('ok')
      expect((await getWithHost(base, '/healthz', { host: 'rebound.example' })).status).toBe(403)
    } finally {
      await new Promise((resolve) => allowing.close(resolve))
    }
  })

  it('serves the app for its routes and 404 for missing files', async () => {
    expect(await (await fetch(`${app}/settings`)).text()).toContain('Kinopeer')
    expect((await fetch(`${app}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${app}/settings`, { method: 'POST' })).status).toBe(404)
  })
})

describe('loginWarning', () => {
  it('warns that nothing asks for a password with the login off, and only then', () => {
    expect(loginWarning({ KINOPEER_AUTH: 'off' })).toBe('own login off (KINOPEER_AUTH=off): keep a login in front of Kinopeer')
    expect(loginWarning({ KINOPEER_AUTH: 'on' })).toBeUndefined()
    expect(loginWarning({})).toBeUndefined()
  })
})

describe('the environment’s login and key', () => {
  async function started(env: Record<string, string | undefined>, saved: { qbittorrentUrl: string; prowlarrUrl: string }) {
    const stores = dataStores(await mkdtemp(join(root, 'secrets-')))
    await stores.settings.update(saved)
    const running = createApp(root, kinopeerServer({ TMDB_PROXY_URL: '', KINOPEER_AUTH: 'off', ...env }, stores))
    await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
    return { base: `http://127.0.0.1:${(running.address() as AddressInfo).port}`, running }
  }

  it.each([
    ['PROWLARR_API_KEY', () => 'env-key'],
    ['PROWLARR_CONFIG_XML', (dir: string) => join(dir, 'config.xml')],
  ])('go only to the environment’s address, never to one saved from the app (Prowlarr’s key from %s)', async (variable, value) => {
    const qbt = await fakeQbittorrent()
    const prowlarr = await fakeProwlarr({ apiKey: 'env-key' })
    const dir = await mkdtemp(join(root, 'config-'))
    await writeFile(join(dir, 'config.xml'), '<Config><ApiKey>env-key</ApiKey></Config>')
    const { base, running } = await started(
      { QBITTORRENT_USERNAME: 'admin', QBITTORRENT_PASSWORD: 'pass word', [variable]: value(dir) },
      { qbittorrentUrl: qbt.base, prowlarrUrl: prowlarr.base },
    )
    try {
      // A browser chose these addresses: the server's own login and key aren't sent there.
      expect((await fetch(`${base}/qbt/api/v2/app/version`, { headers: { 'X-Kinopeer': '1' } })).status).toBe(403)
      expect(qbt.logins()).toBe(0)
      expect(await (await fetch(`${base}/prowlarr/status`)).json()).toEqual({ error: 'not-configured' })
      expect(prowlarr.seen).toEqual([])
      // So the app asks for a login and a key of its own, and has no server key to fall back on.
      expect(await (await fetch(`${base}/api/settings`)).json()).toMatchObject({
        qbittorrent: { configured: false, source: null },
        prowlarr: { configured: false, source: null, serverKey: false },
      })
      const forget = await fetch(`${base}/api/settings/prowlarr`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
      expect(forget.status).toBe(409)
    } finally {
      await new Promise((resolve) => running.close(resolve))
      await closeServers()
    }
  })
})

describe('missingSettings', () => {
  const services = { QBITTORRENT_URL: 'http://qbt', PROWLARR_URL: 'http://prowlarr', PROWLARR_API_KEY: 'p' }

  it('names no TMDB key while the proxy serves the calls without one', async () => {
    const settings = new SettingsStore(join(root, 'missing-proxy'))

    expect(missingSettings(services, settings)).toEqual([])
  })

  it('names the TMDB key with the proxy off and no key', async () => {
    const settings = new SettingsStore(join(root, 'missing-off'))

    expect(missingSettings({ ...services, TMDB_PROXY_URL: '' }, settings)).toEqual(['TMDB key (enter it in the app)'])
    expect(missingSettings({ ...services, TMDB_PROXY_URL: '', TMDB_API_KEY: 'env-key' }, settings)).toEqual([])
    await settings.update({ tmdbApiKey: 'saved-key' })
    expect(missingSettings({ ...services, TMDB_PROXY_URL: '' }, settings)).toEqual([])
  })

  it('names the services and the Prowlarr key that aren’t set', () => {
    const settings = new SettingsStore(join(root, 'missing-services'))

    expect(missingSettings({ TMDB_PROXY_URL: '' }, settings)).toEqual([
      'QBITTORRENT_URL',
      'PROWLARR_URL',
      'PROWLARR_API_KEY',
      'TMDB key (enter it in the app)',
    ])
    expect(missingSettings({ ...services, PROWLARR_API_KEY: undefined, PROWLARR_CONFIG_XML: '/config.xml' }, settings)).toEqual([])
  })

  it('names no service whose address was saved from the app', async () => {
    const settings = new SettingsStore(join(root, 'missing-saved'))
    await settings.update({ qbittorrentUrl: 'http://qbt', prowlarrUrl: 'http://prowlarr', prowlarrApiKey: 'p' })

    expect(missingSettings({}, settings)).toEqual([])
  })

  it('counts the environment’s Prowlarr key only with its address, and a key saved from the app', async () => {
    const settings = new SettingsStore(join(root, 'missing-key'))
    await settings.update({ qbittorrentUrl: 'http://qbt', prowlarrUrl: 'http://prowlarr' })

    // The key the environment sets isn't sent to an address saved from the app: it's to be entered there.
    expect(missingSettings({ PROWLARR_API_KEY: 'p' }, settings)).toEqual(['Prowlarr key (enter it in the app)'])
    expect(missingSettings({ PROWLARR_CONFIG_XML: '/config.xml' }, settings)).toEqual(['Prowlarr key (enter it in the app)'])
    expect(missingSettings({ PROWLARR_URL: 'http://prowlarr' }, settings)).toEqual(['PROWLARR_API_KEY'])
    await settings.update({ prowlarrApiKey: ' ' })
    expect(missingSettings({ PROWLARR_URL: 'http://prowlarr' }, settings)).toEqual(['PROWLARR_API_KEY'])
    await settings.update({ prowlarrApiKey: 'saved' })
    expect(missingSettings({ PROWLARR_URL: 'http://prowlarr' }, settings)).toEqual([])
  })
})

describe('ignoredSettings', () => {
  it('names the environment’s logins and keys set without their service’s address there', () => {
    const secrets = { QBITTORRENT_USERNAME: 'admin', QBITTORRENT_PASSWORD: 'pass', PROWLARR_API_KEY: 'p', PROWLARR_CONFIG_XML: '/config.xml' }

    expect(ignoredSettings(secrets)).toEqual([
      'QBITTORRENT_USERNAME (only with QBITTORRENT_URL)',
      'QBITTORRENT_PASSWORD (only with QBITTORRENT_URL)',
      'PROWLARR_API_KEY (only with PROWLARR_URL)',
      'PROWLARR_CONFIG_XML (only with PROWLARR_URL)',
    ])
    expect(ignoredSettings({ ...secrets, QBITTORRENT_URL: 'http://qbt' })).toEqual(['PROWLARR_API_KEY (only with PROWLARR_URL)', 'PROWLARR_CONFIG_XML (only with PROWLARR_URL)'])
    expect(ignoredSettings({ ...secrets, QBITTORRENT_URL: 'http://qbt', PROWLARR_URL: 'http://prowlarr' })).toEqual([])
    // An address of only spaces is none; a blank variable, as .env.example leaves them, is none either.
    expect(ignoredSettings({ QBITTORRENT_URL: ' ', QBITTORRENT_USERNAME: 'admin', QBITTORRENT_PASSWORD: '', PROWLARR_API_KEY: '' })).toEqual([
      'QBITTORRENT_USERNAME (only with QBITTORRENT_URL)',
    ])
  })
})

describe('tmdbProxy', () => {
  it('is the released versions’ worker by default', () => {
    expect(TMDB_PROXY).toBe('https://tmdb.kinopeer.com/3')
    expect(tmdbProxy({})).toBe(TMDB_PROXY)
  })

  it('is the edge worker the Edge workflow bakes into edge images', async () => {
    interface Step { id?: string; env?: Record<string, string>; with?: Record<string, unknown> }
    interface Job { env?: Record<string, string>; steps?: Step[] }
    const workflow = parse(await readFile(new URL('../.github/workflows/edge.yml', import.meta.url), 'utf8')) as {
      env: Record<string, string>
      jobs: Record<string, Job>
    }
    const jobs = Object.values(workflow.jobs)
    const build = jobs.flatMap((job) => job.steps ?? []).find((step) => step.id === 'build')

    expect(TMDB_PROXY_EDGE).toBe('https://tmdb-edge.kinopeer.com/3')
    // One address for the build and its fingerprint (scripts/edge/fingerprint.ts): the workflow's,
    // which no job or step shadows, and the build arg reads.
    expect(workflow.env.PROXY).toBe(TMDB_PROXY_EDGE)
    for (const scope of [...jobs, ...jobs.flatMap((job) => job.steps ?? [])]) expect(scope.env ?? {}).not.toHaveProperty('PROXY')
    expect(String(build?.with?.['build-args']).split('\n')).toContain('KINOPEER_TMDB_PROXY=${{ env.PROXY }}')
  })

  it('is the one an edge build bakes in, KINOPEER_TMDB_PROXY', () => {
    expect(tmdbProxy({ KINOPEER_TMDB_PROXY: 'https://tmdb-edge.kinopeer.com/3' })).toBe(
      'https://tmdb-edge.kinopeer.com/3',
    )
    // A release build passes the build argument empty.
    expect(tmdbProxy({ KINOPEER_TMDB_PROXY: '' })).toBe(TMDB_PROXY)
    expect(tmdbProxy({ KINOPEER_TMDB_PROXY: ' ' })).toBe(TMDB_PROXY)
  })

  it('takes TMDB_PROXY_URL over both, and none when it’s empty', () => {
    const env = { KINOPEER_TMDB_PROXY: 'https://edge.test/3' }
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: 'https://own.test/3/' })).toBe('https://own.test/3')
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: '' })).toBeUndefined()
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: ' ' })).toBeUndefined()
  })
})

describe('kinopeerServer', () => {
  it('sends TMDB calls without a key to the proxy, and says Kinopeer’s key is used', async () => {
    const proxy = await fakeTmdb()
    const server = createApp(root, kinopeerServer({ TMDB_PROXY_URL: proxy.apiBase, KINOPEER_AUTH: 'off' }, dataStores(join(root, 'proxy'))))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${base}/tmdb/configuration`)).status).toBe(200)
      expect(proxy.seen.map((request) => request.url)).toEqual(['/3/configuration'])
      expect(await (await fetch(`${base}/api/settings`)).json()).toMatchObject({ tmdb: { configured: true, source: 'shared', fallback: 'shared' } })
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await closeServers()
    }
  })

  it('points the TMDB bridge at TMDB_API_URL and TMDB_IMAGE_URL', async () => {
    const tmdb = await fakeTmdb()
    const env = { TMDB_API_KEY: 'good-key', TMDB_API_URL: tmdb.apiBase, TMDB_IMAGE_URL: `${tmdb.base}/t/p`, KINOPEER_AUTH: 'off' }
    const server = createApp(root, kinopeerServer(env, dataStores(join(root, 'tmdb'))))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${base}/tmdb/movie/693134`)).status).toBe(200)
      expect((await fetch(`${base}/tmdb-img/w342/poster.jpg`)).headers.get('content-type')).toBe('image/jpeg')
      expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/693134?api_key=good-key', '/t/p/w342/poster.jpg'])
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await closeServers()
    }
  })

  it('refuses to start with a KINOPEER_AUTH it doesn’t know, so a typo neither opens nor locks it', () => {
    expect(() => kinopeerServer({ KINOPEER_AUTH: 'of' }, dataStores(join(root, 'typo')))).toThrow('KINOPEER_AUTH must be "on" or "off", not "of"')
    expect(() => kinopeerServer({ KINOPEER_AUTH: ' OFF ' }, dataStores(join(root, 'typo')))).not.toThrow()
    expect(() => kinopeerServer({ KINOPEER_AUTH: 'on' }, dataStores(join(root, 'typo')))).not.toThrow()
  })

  it('refuses to start with a KINOPEER_PASSWORD no sign-in could send, so it never locks everyone out', () => {
    const start = (password: string) => () => kinopeerServer({ KINOPEER_PASSWORD: password }, dataStores(join(root, 'env-password')))
    expect(start('x'.repeat(257))).toThrow('KINOPEER_PASSWORD must be 8 to 256 characters, not 257')
    expect(start('x'.repeat(7))).toThrow('KINOPEER_PASSWORD must be 8 to 256 characters, not 7')
    expect(start('x'.repeat(256))).not.toThrow()
    expect(start('x'.repeat(8))).not.toThrow()
    // Empty is unset, as in .env.example.
    expect(start('')).not.toThrow()
  })

  it('forgets nothing while qBittorrent has no address', async () => {
    const stores = dataStores(join(root, 'no-jobs'))
    const prune = vi.spyOn(stores.matches, 'prune')
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const stop = kinopeerServer({}, stores).startJobs()
      // The first check and the next, each failing to reach qBittorrent.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
      stop()
      expect(prune).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['the environment', 'the app, after the server started'])('checks qBittorrent’s torrents to forget the matches of deleted ones, at the address from %s', async (from) => {
    const present = 'a'.repeat(40)
    const deleted = 'b'.repeat(40)
    const qbittorrent = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(request.url === '/api/v2/torrents/info' ? JSON.stringify([{ hash: present }]) : '[]')
    })
    await new Promise<void>((resolve) => qbittorrent.listen(0, '127.0.0.1', resolve))
    const stores = dataStores(join(root, `jobs-${from.length}`))
    await stores.matches.save({
      [present]: { type: 'movie', id: 1, source: 'user' },
      [deleted]: { type: 'movie', id: 2, source: 'guess', version: 2 },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const url = `http://127.0.0.1:${(qbittorrent.address() as AddressInfo).port}`
      const fromEnv = from === 'the environment'
      const stop = kinopeerServer(fromEnv ? { QBITTORRENT_URL: url } : {}, stores).startJobs()
      if (!fromEnv) await stores.settings.update({ qbittorrentUrl: url })
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() => expect(stores.matches.current[deleted]?.missingSince).toBeTypeOf('number'))
      expect(stores.matches.current[present]?.missingSince).toBeUndefined()
      stop()
    } finally {
      vi.useRealTimers()
      await new Promise((resolve) => qbittorrent.close(resolve))
    }
  })

  it('notifies through the Telegram bot when a tagged torrent finishes, naming the title the server matched, then takes the tag off', async () => {
    const finished = { ...TORRENTS[0], hash: 'c'.repeat(40), name: 'Dune.Part.Two.2024.2160p.WEB-DL-GRPA', progress: 1, state: 'stalledUP', tags: 'kinopeer:notify' } as const
    const downloading = { ...TORRENTS[0], hash: 'd'.repeat(40), progress: 0.3, state: 'downloading', tags: 'kinopeer:notify' } as const
    const qbittorrent = await fakeQbittorrent({ torrents: [finished, downloading] })
    const tmdb = await fakeTmdb()
    const telegram = await fakeTelegram()
    const stores = dataStores(join(root, 'notify'))
    await stores.settings.update({
      telegram: { token: TELEGRAM_TOKEN, bot: 'kinopeer_home_bot', chat: { id: 42, name: 'Alex', type: 'private' }, language: 'ru' },
    })
    await stores.matches.save({ [finished.hash]: { type: 'movie', id: 693134, source: 'guess', version: 1 } })
    const env = {
      QBITTORRENT_URL: qbittorrent.base,
      QBITTORRENT_USERNAME: 'admin',
      QBITTORRENT_PASSWORD: 'pass word',
      TMDB_API_KEY: 'good-key',
      TMDB_API_URL: tmdb.apiBase,
      TELEGRAM_API_URL: telegram.base,
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const stop = kinopeerServer(env, stores).startJobs()
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(() => expect(qbittorrent.torrents[0].tags).toBe(''))
      expect(telegram.sent()).toEqual([
        expect.objectContaining({ chat_id: 42, text: 'Загрузка завершена: Дюна: Часть вторая (2024)\nDune.Part.Two.2024.2160p.WEB-DL-GRPA' }),
      ])
      expect(qbittorrent.torrents[1].tags).toBe('kinopeer:notify')
      expect(qbittorrent.seen.some((request) => request.url?.startsWith('/api/v2/sync/maindata'))).toBe(false)

      // Stopped, it asks nothing more.
      stop()
      const asked = qbittorrent.seen.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(qbittorrent.seen).toHaveLength(asked)
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies the devices push.json keeps when a tagged torrent finishes, opening the torrent, then takes the tag off', async () => {
    const finished = { ...TORRENTS[0], hash: 'e'.repeat(40), name: 'Dune.Part.Two.2024.2160p.WEB-DL-GRPA', progress: 1, state: 'uploading', tags: 'kinopeer:notify' } as const
    const qbittorrent = await fakeQbittorrent({ torrents: [finished] })
    const tmdb = await fakeTmdb()
    const push = await fakePushService()
    const saved = dataStores(join(root, 'push'))
    await saved.push.save({ ...push.subscribe('/send/phone'), language: 'ru', added: 0 })
    await saved.matches.save({ [finished.hash]: { type: 'movie', id: 693134, source: 'guess', version: 1 } })
    // A server started afresh, as on a restart, reads the device the notifier sends to from push.json.
    const stores = dataStores(join(root, 'push'))
    await loadStores(stores)
    const env = {
      QBITTORRENT_URL: qbittorrent.base,
      QBITTORRENT_USERNAME: 'admin',
      QBITTORRENT_PASSWORD: 'pass word',
      TMDB_API_KEY: 'good-key',
      TMDB_API_URL: tmdb.apiBase,
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const stop = kinopeerServer(env, stores).startJobs()
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(() => expect(qbittorrent.torrents[0].tags).toBe(''))
      expect(push.pushes.map(({ payload }) => payload)).toEqual([
        {
          title: 'Загрузка завершена',
          body: 'Дюна: Часть вторая (2024)\nDune.Part.Two.2024.2160p.WEB-DL-GRPA',
          url: `/torrent/${finished.hash}`,
          tag: finished.hash,
        },
      ])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks qBittorrent nothing for notifications while no channel is set up', async () => {
    const qbittorrent = await fakeQbittorrent()
    const stores = dataStores(join(root, 'notify-off'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const stop = kinopeerServer({ QBITTORRENT_URL: qbittorrent.base, QBITTORRENT_USERNAME: 'admin', QBITTORRENT_PASSWORD: 'pass word' }, stores).startJobs()
      await vi.advanceTimersByTimeAsync(59_000)
      expect(qbittorrent.seen).toEqual([])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
