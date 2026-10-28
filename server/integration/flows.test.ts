/**
 * User flows across several routes: what a screen does in the browser, with the real clients, the
 * real server and the fakes behind it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clearGuesses, saveMatches } from '../../src/api/matches/client.ts'
import { fetchRelease, searchReleases } from '../../src/api/prowlarr/client.ts'
import { UnauthorizedError, getAppVersion } from '../../src/api/qbittorrent/client.ts'
import { saveQbittorrentLogin } from '../../src/api/settings/client.ts'
import { addRelease } from '../../src/releases/addRelease.ts'
import { SHOGUN_FILES, shogunTorrent, tmdbTag, torrentFiles } from '../../src/test/fixtures.ts'
import { readTorrentFile } from '../../src/torrents/torrentFile.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

describe('logging in to qBittorrent', () => {
  it('goes through the server, which keeps the session and the password to itself', async () => {
    const { qbittorrent, cookies, responses } = await startKinoseed({
      env: { QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined },
    })

    // Without a login the server forwards as is; qBittorrent refuses, so the app asks for one.
    await expect(getAppVersion()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(qbittorrent.seen.at(-1)).toMatchObject({ url: '/api/v2/app/version', cookie: undefined })

    // A wrong pair is tried once and not saved.
    await expect(saveQbittorrentLogin('admin', 'wrong')).rejects.toMatchObject({ status: 422, code: 'invalid-credentials' })
    expect(qbittorrent.logins()).toBe(1)
    await expect(getAppVersion()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(qbittorrent.logins()).toBe(1)

    // The right one is saved and used from then on, by the server.
    await expect(saveQbittorrentLogin('admin', 'pass word')).resolves.toMatchObject({ qbittorrent: { configured: true, source: 'saved' } })
    await expect(getAppVersion()).resolves.toBe('v5.2.4')
    expect(qbittorrent.seen.at(-1)).toMatchObject({ url: '/api/v2/app/version', cookie: 'SID=sid3' })
    expect(cookies.all()).toEqual({})
    for (const response of responses) expect(await response.text()).not.toMatch(/pass word|SID=/)

    // The browser can't log in itself, so it can't get the server's address banned.
    const login = await fetch('/qbt/api/v2/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'pass word' }),
    })
    expect(login.status).toBe(404)
    expect(qbittorrent.logins()).toBe(3)
  })
})

describe('adding a release', () => {
  it('gets the .torrent through the server, then adds it to qBittorrent with the files chosen', async () => {
    const { qbittorrent, prowlarr, responses } = await startKinoseed()

    const [release] = await searchReleases('Shogun', { type: 'tvsearch' })
    expect(release.download).toBe('1/download?link=shogun')
    const source = await fetchRelease(release)
    expect(source.kind).toBe('torrent')
    const file = (source as { file: File }).file
    expect(prowlarr.seen.at(-1)).toEqual({ url: `/api/v1/indexer/1/download?link=shogun&apikey=${prowlarr.apiKey}`, key: prowlarr.apiKey })

    // The browser reads the file to know the hash and the files before adding (AddReleaseSheet).
    const meta = await readTorrentFile(new Uint8Array(await file.arrayBuffer()))
    expect(meta.name).toBe('Shogun.S01.2160p')
    expect(meta.files).toHaveLength(SHOGUN_FILES.length)
    qbittorrent.files.set(meta.infoHash, torrentFiles().map((item) => ({ ...item, progress: 0, priority: 1 })))

    const skip = [10, 11, 12, 13] // the subtitles and the .nfo
    await addRelease(
      source,
      { tags: [tmdbTag('tv', 126308)], category: 'TV Shows', paused: false, sequential: true, firstLastPieces: true, topOfQueue: false },
      { meta, skip },
      () => Promise.resolve(),
    )

    expect(qbittorrent.seen.map((request) => request.url)).toEqual([
      '/api/v2/torrents/add',
      `/api/v2/torrents/files?hash=${meta.infoHash}`,
      '/api/v2/torrents/filePrio',
      '/api/v2/torrents/start',
    ])
    expect(qbittorrent.added).toEqual([
      {
        files: [{ name: file.name, bytes: shogunTorrent() }],
        urls: [],
        tags: ['tmdb:tv:126308'],
        category: 'TV Shows',
        savePath: undefined,
        stopped: true,
        sequential: true,
        firstLastPieces: true,
        topOfQueue: false,
      },
    ])
    expect(qbittorrent.seen[2].body).toBe(`hash=${meta.infoHash}&id=10%7C11%7C12%7C13&priority=0`)
    expect(qbittorrent.files.get(meta.infoHash)?.map((item) => item.priority)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
    expect(qbittorrent.seen[3].body).toBe(`hashes=${meta.infoHash}`)
    expect(qbittorrent.seen.every((request) => request.cookie === 'SID=sid1')).toBe(true)
    for (const response of responses) expect(await response.text()).not.toContain(prowlarr.apiKey)
  })
})

describe('matching torrents to titles', () => {
  it('keeps the user’s choice over a guess and forgets only the guesses', async () => {
    const A = 'a'.repeat(40)
    const B = 'b'.repeat(40)
    const guess = { type: 'movie', id: 27205, source: 'guess', version: 2 } as const
    const choice = { type: 'movie', id: 693134, source: 'user' } as const
    const { stores } = await startKinoseed()

    await expect(saveMatches({ [A]: guess })).resolves.toEqual({ [A]: guess })
    await expect(saveMatches({ [A]: choice })).resolves.toEqual({ [A]: choice })
    await expect(saveMatches({ [A]: { ...guess, version: 3 }, [B]: guess })).resolves.toEqual({ [A]: choice, [B]: guess })
    await expect(clearGuesses()).resolves.toEqual({ [A]: choice })
    expect(stores.matches.current).toEqual({ [A]: choice })
  })
})
