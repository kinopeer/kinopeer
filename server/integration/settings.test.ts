import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsError, getServerSettings, saveDownloadDefaults, forgetProwlarrKey, saveProwlarrKey, saveQbittorrentLogin, saveTmdbKey } from '../../src/api/settings/client.ts'
import { getProwlarrStatus } from '../../src/api/prowlarr/client.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(async () => {
  vi.restoreAllMocks()
  await stopKinoseed()
})

describe('settings client through /api/settings', () => {
  it('reads where each secret comes from, never the secret', async () => {
    const { responses } = await startKinoseed()
    await expect(getServerSettings()).resolves.toEqual({
      tmdb: { configured: true, source: 'env' },
      prowlarr: { configured: true, source: 'env', serverKey: true },
      qbittorrent: { configured: true, source: 'env' },
      downloads: null,
    })
    expect(await responses[0].text()).not.toMatch(/good-key|pass word/)
  })

  it('saves a TMDB key the server has checked with TMDB', async () => {
    const { tmdb, stores } = await startKinoseed({ env: { TMDB_API_KEY: undefined } })
    await expect(saveTmdbKey('good-key')).resolves.toMatchObject({ tmdb: { configured: true, source: 'saved' } })
    expect(tmdb.seen).toEqual([{ url: '/3/authentication?api_key=good-key', authorization: undefined, cookie: undefined }])
    expect(stores.settings.current.tmdbApiKey).toBe('good-key')
    await expect(getServerSettings()).resolves.toMatchObject({ tmdb: { configured: true, source: 'saved' } })
  })

  it('saves a Prowlarr key that then wins over a stale PROWLARR_API_KEY', async () => {
    const { prowlarr, stores } = await startKinoseed({ env: { PROWLARR_API_KEY: 'stale-key' } })
    await expect(getProwlarrStatus()).rejects.toThrow()
    await expect(saveProwlarrKey('wrong-key')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })

    await expect(saveProwlarrKey(prowlarr.apiKey)).resolves.toMatchObject({ prowlarr: { configured: true, source: 'saved', serverKey: true } })
    expect(stores.settings.current.prowlarrApiKey).toBe(prowlarr.apiKey)
    await expect(getProwlarrStatus()).resolves.toMatchObject({ indexers: expect.any(Number) })

    await expect(forgetProwlarrKey()).resolves.toMatchObject({ prowlarr: { source: 'env' } })
    expect(stores.settings.current.prowlarrApiKey).toBeUndefined()
  })

  it('passes on why the server refused a key', async () => {
    const { stores } = await startKinoseed()
    await expect(saveTmdbKey('bad-key')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })
    expect(stores.settings.current.tmdbApiKey).toBeUndefined()

    await startKinoseed({ env: { TMDB_API_URL: 'http://127.0.0.1:9/3' } })
    await expect(saveTmdbKey('good-key')).rejects.toMatchObject({ status: 502, code: 'unreachable' })
  })

  it('saves a qBittorrent login the server has tried, and passes refusals on', async () => {
    const { qbittorrent, stores, responses } = await startKinoseed({ env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined } })
    await expect(saveQbittorrentLogin('admin', 'pass word')).resolves.toMatchObject({ qbittorrent: { configured: true, source: 'saved' } })
    expect(qbittorrent.logins()).toBe(1)
    expect(stores.settings.current).toMatchObject({ qbittorrentUsername: 'admin', qbittorrentPassword: 'pass word' })
    expect(await responses[0].text()).not.toContain('pass word')

    await expect(saveQbittorrentLogin('banned', 'x')).rejects.toMatchObject({ status: 429, code: 'banned' })
    await expect(saveQbittorrentLogin('admin', 'wrong')).rejects.toMatchObject({ status: 422, code: 'invalid-credentials' })
    expect(stores.settings.current.qbittorrentPassword).toBe('pass word')

    await startKinoseed({ env: { QBITTORRENT_URL: undefined } })
    await expect(saveQbittorrentLogin('admin', 'x')).rejects.toMatchObject({ status: 503, code: 'not-configured' })
  })

  it('patches only the download defaults given, so two devices’ changes both stay', async () => {
    const { stores } = await startKinoseed()
    await expect(saveDownloadDefaults({ startPaused: true, movieCategory: null })).resolves.toMatchObject({
      downloads: { startPaused: true, movieCategory: null },
    })
    await expect(saveDownloadDefaults({ sequential: true })).resolves.toMatchObject({
      downloads: { startPaused: true, movieCategory: null, sequential: true },
    })
    expect(stores.settings.current.downloads).toEqual({ startPaused: true, movieCategory: null, sequential: true })
  })

  it('says when the data directory is not writable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startKinoseed({ writableData: false })
    const error = await saveDownloadDefaults({ sequential: true }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SettingsError)
    expect(error).toMatchObject({ status: 500, code: 'storage' })
  })
})
