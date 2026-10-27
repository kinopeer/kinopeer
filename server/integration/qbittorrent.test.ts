import { afterEach, describe, expect, it } from 'vitest'
import {
  QbittorrentError,
  UnauthorizedError,
  getAppVersion,
  getMainData,
  getTorrentTrackers,
  getTorrents,
} from '../../src/api/qbittorrent/client.ts'
import { TORRENTS, mainData } from '../../src/test/fixtures.ts'
import { TRACKERS, mainDataDelta } from '../test/fakes.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

describe('qBittorrent client through /qbt', () => {
  it('reads the version with the session the server holds, which never reaches the browser', async () => {
    const { qbittorrent, cookies } = await startKinoseed()
    await expect(getAppVersion()).resolves.toBe('v5.2.4')
    expect(qbittorrent.seen).toEqual([expect.objectContaining({ method: 'GET', url: '/api/v2/app/version', cookie: 'SID=sid1' })])
    expect(cookies.all()).toEqual({})
  })

  it('throws UnauthorizedError when the server has no login and qBittorrent wants one', async () => {
    const { qbittorrent } = await startKinoseed({ env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined } })
    await expect(getAppVersion()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(qbittorrent.seen.at(-1)).toMatchObject({ url: '/api/v2/app/version', cookie: undefined })
    expect(qbittorrent.logins()).toBe(0)
  })

  it('throws QbittorrentError with the server’s status when qBittorrent is unreachable or not set up', async () => {
    await startKinoseed({ env: { QBITTORRENT_URL: 'http://127.0.0.1:9' } })
    const unreachable = await getAppVersion().catch((error: unknown) => error)
    expect(unreachable).toBeInstanceOf(QbittorrentError)
    expect(unreachable).not.toBeInstanceOf(UnauthorizedError)
    expect((unreachable as QbittorrentError).status).toBe(502)

    await startKinoseed({ env: { QBITTORRENT_URL: undefined } })
    await expect(getAppVersion()).rejects.toMatchObject({ status: 503 })
  })

  it('lists every torrent with no query string', async () => {
    const { qbittorrent } = await startKinoseed()
    await expect(getTorrents()).resolves.toEqual(TORRENTS)
    expect(qbittorrent.seen.map((request) => request.url)).toEqual(['/api/v2/torrents/info'])
  })

  it('syncs the full state first and the delta after its response id', async () => {
    const { qbittorrent } = await startKinoseed()
    await expect(getMainData()).resolves.toEqual(mainData())
    await expect(getMainData(1)).resolves.toEqual(mainDataDelta(TORRENTS, 1))
    expect(qbittorrent.seen.map((request) => request.url)).toEqual(['/api/v2/sync/maindata?rid=0', '/api/v2/sync/maindata?rid=1'])
  })

  it('reads the trackers of one torrent', async () => {
    const { qbittorrent } = await startKinoseed()
    await expect(getTorrentTrackers('a1')).resolves.toEqual(TRACKERS)
    expect(qbittorrent.seen.map((request) => request.url)).toEqual(['/api/v2/torrents/trackers?hash=a1'])
  })
})
