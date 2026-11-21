import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsError, getServerSettings, saveDownloadDefaults, forgetProwlarrKey, forgetTmdbKey, saveProwlarrKey, saveQbittorrentLogin, saveTmdbKey } from '../../src/api/settings/client.ts'
import { setUpPassword } from '../../src/api/auth/index.ts'
import { getProwlarrStatus } from '../../src/api/prowlarr/client.ts'
import { NoAddressError, getAppVersion } from '../../src/api/qbittorrent/client.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(async () => {
  await stopKinopeer()
})

describe('settings client through /api/settings', () => {
  it('reads where each secret comes from, never the secret', async () => {
    const { responses } = await startKinopeer()
    await expect(getServerSettings()).resolves.toEqual({
      tmdb: { configured: true, source: 'env', fallback: 'env' },
      prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
      qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
      downloads: null,
      auth: { enabled: false },
      telegram: { bot: null, chat: null, refused: null },
      push: { devices: 0 },
      notifications: false,
    })
    expect(await responses[0].text()).not.toMatch(/good-key|pass word/)
  })

  it('saves a TMDB key the server has checked with TMDB', async () => {
    const { tmdb, stores } = await startKinopeer({ env: { TMDB_API_KEY: undefined } })
    await expect(saveTmdbKey('good-key')).resolves.toMatchObject({ tmdb: { configured: true, source: 'saved', fallback: null } })
    expect(tmdb.seen).toEqual([{ url: '/3/authentication?api_key=good-key', authorization: undefined, cookie: undefined }])
    expect(stores.settings.current.tmdbApiKey).toBe('good-key')
    await expect(getServerSettings()).resolves.toMatchObject({ tmdb: { configured: true, source: 'saved', fallback: null } })
  })

  it('keeps a saved TMDB key when nothing else would serve TMDB', async () => {
    const { stores } = await startKinopeer({ env: { TMDB_API_KEY: undefined } })
    await saveTmdbKey('good-key')

    await expect(forgetTmdbKey()).rejects.toMatchObject({ status: 409, code: 'no-server-key' })
    expect(stores.settings.current.tmdbApiKey).toBe('good-key')
  })

  it('saves a Prowlarr key that then wins over a stale PROWLARR_API_KEY', async () => {
    const { prowlarr, stores } = await startKinopeer({ env: { PROWLARR_API_KEY: 'stale-key' } })
    await expect(getProwlarrStatus()).rejects.toThrow()
    await expect(saveProwlarrKey('wrong-key')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })

    await expect(saveProwlarrKey(prowlarr.apiKey)).resolves.toMatchObject({ prowlarr: { configured: true, source: 'saved', serverKey: true } })
    expect(stores.settings.current.prowlarrApiKey).toBe(prowlarr.apiKey)
    await expect(getProwlarrStatus()).resolves.toMatchObject({ indexers: expect.any(Number) })

    await expect(forgetProwlarrKey()).resolves.toMatchObject({ prowlarr: { source: 'env' } })
    expect(stores.settings.current.prowlarrApiKey).toBeUndefined()
    await expect(getProwlarrStatus()).rejects.toThrow()
  })

  it('passes on why the server refused a key', async () => {
    const { stores } = await startKinopeer()
    await expect(saveTmdbKey('bad-key')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })
    expect(stores.settings.current.tmdbApiKey).toBeUndefined()

    await startKinopeer({ env: { TMDB_API_URL: 'http://127.0.0.1:9/3' } })
    await expect(saveTmdbKey('good-key')).rejects.toMatchObject({ status: 502, code: 'unreachable' })
  })

  it('saves a qBittorrent login the server has tried, and passes refusals on', async () => {
    const { qbittorrent, stores, responses } = await startKinopeer({ env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined } })
    await expect(saveQbittorrentLogin('admin', 'pass word')).resolves.toMatchObject({ qbittorrent: { configured: true, source: 'saved' } })
    expect(qbittorrent.logins()).toBe(1)
    expect(stores.settings.current).toMatchObject({ qbittorrentUsername: 'admin', qbittorrentPassword: 'pass word' })
    expect(await responses[0].text()).not.toContain('pass word')

    await expect(saveQbittorrentLogin('banned', 'x')).rejects.toMatchObject({ status: 429, code: 'banned' })
    await expect(saveQbittorrentLogin('admin', 'wrong')).rejects.toMatchObject({ status: 422, code: 'invalid-credentials' })
    expect(stores.settings.current.qbittorrentPassword).toBe('pass word')

    await startKinopeer({ env: { QBITTORRENT_URL: undefined } })
    await expect(saveQbittorrentLogin('admin', 'x')).rejects.toMatchObject({ status: 503, code: 'not-configured' })
  })

  it('says when qBittorrent refuses the address’s port, and saves nothing (#508)', async () => {
    // Its Web UI on 8080, published on the fake's own port: Host header validation refuses the login.
    const { stores } = await startKinopeer({ qbittorrent: { webUiPort: 8080 }, env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined } })
    await expect(saveQbittorrentLogin('admin', 'pass word')).rejects.toMatchObject({ status: 502, code: 'host-refused' })
    expect(stores.settings.current.qbittorrentPassword).toBeUndefined()
  })

  it('patches only the download defaults given, so two devices’ changes both stay', async () => {
    const { stores } = await startKinopeer()
    await expect(saveDownloadDefaults({ startPaused: true, movieCategory: null })).resolves.toMatchObject({
      downloads: { startPaused: true, movieCategory: null },
    })
    await expect(saveDownloadDefaults({ sequential: true })).resolves.toMatchObject({
      downloads: { startPaused: true, movieCategory: null, sequential: true },
    })
    expect(stores.settings.current.downloads).toEqual({ startPaused: true, movieCategory: null, sequential: true })
  })

  it('says qBittorrent has no address, then saves the ones the app sends with a login and a key', async () => {
    // Beyond Umbrel: the login on, and no address in the environment. qBittorrent's auth bypass lets
    // the server in without a login, as a Compose install seeds it.
    const { qbittorrent, prowlarr, stores } = await startKinopeer({
      env: { KINOPEER_AUTH: undefined, QBITTORRENT_URL: undefined, PROWLARR_URL: undefined },
      qbittorrent: { authBypass: true },
    })
    await setUpPassword('correct horse')
    await expect(getAppVersion()).rejects.toBeInstanceOf(NoAddressError)
    await expect(getServerSettings()).resolves.toMatchObject({ qbittorrent: { address: { source: null } }, prowlarr: { address: { source: null } } })

    await expect(saveQbittorrentLogin('', '', `${qbittorrent.base}/`)).resolves.toMatchObject({
      qbittorrent: { address: { source: 'saved', url: qbittorrent.base } },
    })
    await expect(getAppVersion()).resolves.toBe('5.2.4')
    await expect(saveProwlarrKey(prowlarr.apiKey, prowlarr.base)).resolves.toMatchObject({
      prowlarr: { configured: true, source: 'saved', address: { source: 'saved', url: prowlarr.base } },
    })
    await expect(getProwlarrStatus()).resolves.toMatchObject({ indexers: expect.any(Number) })
    expect(stores.settings.current).toMatchObject({ qbittorrentUrl: qbittorrent.base, prowlarrUrl: prowlarr.base })
    // A save without an address leaves the saved one as it is.
    await saveProwlarrKey(prowlarr.apiKey)
    expect(stores.settings.current.prowlarrUrl).toBe(prowlarr.base)
  })

  it('says when the data directory is not writable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startKinopeer({ writableData: false })
    const error = await saveDownloadDefaults({ sequential: true }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SettingsError)
    expect(error).toMatchObject({ status: 500, code: 'storage' })
  })
})
