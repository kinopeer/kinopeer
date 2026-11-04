import { afterEach, describe, expect, it } from 'vitest'
import {
  QbittorrentError,
  UnauthorizedError,
  getAppVersion,
  getMainData,
  getTorrentTrackers,
  getSaveLocations,
  getTorrents,
  setCategory,
  setTorrentLocation,
  toggleFirstLastPiecePrio,
  toggleSequentialDownload,
} from '../../src/api/qbittorrent/client.ts'
import { TORRENTS, mainData, torrent } from '../../src/test/fixtures.ts'
import { TRACKERS, mainDataDelta } from '../test/fakes.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

describe('qBittorrent client through /qbt', () => {
  it('reads the version with the session the server holds, which never reaches the browser', async () => {
    const { qbittorrent, cookies } = await startKinoseed()
    await expect(getAppVersion()).resolves.toBe('5.2.4')
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

  it('reads the save locations: the categories, the default save path and the preferences that place them', async () => {
    await startKinoseed()
    await expect(getSaveLocations()).resolves.toEqual({
      categories: [
        { name: 'Movies', savePath: '/downloads/movies' },
        { name: 'TV Shows', savePath: '/downloads/tv' },
      ],
      defaultPath: '/downloads',
      categoryPaths: false,
      subcategories: false,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
  })

  it('changes a torrent’s category, which moves the files of one under automatic management', async () => {
    const { qbittorrent } = await startKinoseed({ qbittorrent: { torrents: [torrent('auto', { auto_tmm: true }), torrent('manual')] } })
    await setCategory(['auto', 'manual'], 'TV Shows')
    expect(qbittorrent.torrents).toMatchObject([
      { hash: 'auto', category: 'TV Shows', save_path: '/downloads/tv' },
      { hash: 'manual', category: 'TV Shows', save_path: '/downloads' },
    ])
    await expect(setCategory(['auto'], 'Gone')).rejects.toMatchObject({ status: 409 })
  })

  it('flips sequential download and first and last pieces first', async () => {
    const { qbittorrent } = await startKinoseed({ qbittorrent: { torrents: [torrent('a', { seq_dl: true })] } })
    await toggleSequentialDownload(['a'])
    await toggleFirstLastPiecePrio(['a'])
    expect(qbittorrent.torrents[0]).toMatchObject({ seq_dl: false, f_l_piece_prio: true })
  })

  it('moves a torrent’s files', async () => {
    const { qbittorrent } = await startKinoseed()
    await setTorrentLocation([TORRENTS[0].hash], '/media/movies')
    expect(qbittorrent.torrents[0].save_path).toBe('/media/movies')
  })

  it('tells a folder qBittorrent can’t write to or create from a lost session', async () => {
    const { qbittorrent } = await startKinoseed()
    const denied = await setTorrentLocation([TORRENTS[0].hash], '/readonly/movies').catch((error: unknown) => error)
    expect(denied).toBeInstanceOf(QbittorrentError)
    expect(denied).not.toBeInstanceOf(UnauthorizedError)
    expect(denied).toMatchObject({ status: 403 })
    // The server takes qBittorrent's 403 for an expired session and logs in again once before
    // passing it on; the browser's session check then tells it's the folder.
    expect(qbittorrent.logins()).toBe(2)
    await expect(setTorrentLocation([TORRENTS[0].hash], '/unmakeable/movies')).rejects.toMatchObject({ status: 409 })
  })

  it('reports a lost session on a move when the server has no login', async () => {
    await startKinoseed({ env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined } })
    await expect(setTorrentLocation([TORRENTS[0].hash], '/media/movies')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
