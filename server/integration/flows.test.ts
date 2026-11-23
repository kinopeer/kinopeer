/**
 * User flows across several routes: what a screen does in the browser, with the real clients, the
 * real server and the fakes behind it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clearGuesses, saveMatches } from '../../src/api/matches/client.ts'
import { fetchRelease, searchReleases } from '../../src/api/prowlarr/client.ts'
import { UnauthorizedError, exportTorrent, getAppVersion, getTorrentFiles, renameFiles } from '../../src/api/qbittorrent/client.ts'
import { saveQbittorrentLogin } from '../../src/api/settings/client.ts'
import { addRelease } from '../../src/releases/addRelease.ts'
import { DUNE_TORRENT, SHOGUN_FILES, duneFiles, duneTorrent, shogunTorrent, tmdbTag, torrent, torrentFiles } from '../../src/test/fixtures.ts'
import { originalNames } from '../../src/torrents/mediaNames.ts'
import { readTorrentFile } from '../../src/torrents/torrentFile.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(stopKinopeer)

describe('logging in to qBittorrent', () => {
  it('goes through the server, which keeps the session and the password to itself', async () => {
    const { qbittorrent, cookies, responses } = await startKinopeer({
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
    await expect(getAppVersion()).resolves.toBe('5.2.4')
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
    const { qbittorrent, prowlarr, responses } = await startKinopeer()

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

describe('naming a movie for a media server', () => {
  it('adds the movie stopped, renames its files in place once qBittorrent lists them, then starts it', async () => {
    const meta = await readTorrentFile(duneTorrent())
    const listed = torrent(meta.infoHash, { name: DUNE_TORRENT.name, save_path: '/downloads', content_path: `/downloads/${DUNE_TORRENT.name}` })
    const { qbittorrent } = await startKinopeer({ qbittorrent: { listAdded: () => listed } })
    const file = new File([duneTorrent().slice()], 'dune.torrent')
    qbittorrent.files.set(meta.infoHash, duneFiles())

    await addRelease(
      { kind: 'torrent', file },
      { tags: [tmdbTag('movie', 693134)], paused: false, sequential: false, firstLastPieces: false, topOfQueue: false, mediaNames: { type: 'movie', title: 'Dune: Part Two', year: 2024 } },
      { meta, skip: [] },
      () => Promise.resolve(),
    )

    expect(qbittorrent.seen.map((request) => request.url)).toEqual([
      '/api/v2/torrents/add',
      `/api/v2/torrents/files?hash=${meta.infoHash}`,
      // Where qBittorrent put it, and whether another torrent is in the folder naming would use.
      '/api/v2/torrents/info',
      ...Array<string>(4).fill('/api/v2/torrents/renameFile'),
      '/api/v2/torrents/start',
    ])
    expect(qbittorrent.added[0].stopped).toBe(true)
    expect((await getTorrentFiles(meta.infoHash)).map((item) => item.name)).toEqual([
      'Dune - Part Two (2024)/Dune - Part Two (2024).mkv',
      'Dune - Part Two (2024)/Dune - Part Two (2024).ru.forced.srt',
      'Dune - Part Two (2024)/Dune - Part Two (2024).nfo',
      `Dune - Part Two (2024)/Sample/${DUNE_TORRENT.name}-sample.mkv`,
    ])
  })

  it('leaves the files as they are when another torrent is in the folder naming would use there, and starts it', async () => {
    const meta = await readTorrentFile(duneTorrent())
    const listed = torrent(meta.infoHash, { name: DUNE_TORRENT.name, save_path: '/downloads', content_path: `/downloads/${DUNE_TORRENT.name}` })
    const older = torrent('e'.repeat(40), { name: 'Dune.Part.Two.2024.1080p', save_path: '/downloads', content_path: '/downloads/Dune - Part Two (2024)' })
    const { qbittorrent } = await startKinopeer({ qbittorrent: { torrents: [older], listAdded: () => listed } })
    qbittorrent.files.set(meta.infoHash, duneFiles())

    const adding = addRelease(
      { kind: 'torrent', file: new File([duneTorrent().slice()], 'dune.torrent') },
      { tags: [], paused: false, sequential: false, firstLastPieces: false, topOfQueue: false, mediaNames: { type: 'movie', title: 'Dune: Part Two', year: 2024 } },
      { meta, skip: [] },
      () => Promise.resolve(),
    )

    await expect(adding).rejects.toMatchObject({ name: 'MediaNamesError', taken: { name: 'Dune.Part.Two.2024.1080p', folder: 'Dune - Part Two (2024)' } })
    expect(qbittorrent.seen.map((request) => request.url)).not.toContain('/api/v2/torrents/renameFile')
    expect(qbittorrent.seen.map((request) => request.url)).toContain('/api/v2/torrents/start')
    expect((await getTorrentFiles(meta.infoHash)).map((item) => item.name)).toEqual(duneFiles().map((item) => item.name))
  })

  it('reads the original names back from the .torrent qBittorrent exports, byte for byte through the bridge', async () => {
    const { qbittorrent } = await startKinopeer()
    const meta = await readTorrentFile(duneTorrent())
    qbittorrent.exports.set(meta.infoHash, duneTorrent())
    qbittorrent.files.set(meta.infoHash, duneFiles().map((item) => ({ ...item, name: item.name.replaceAll(DUNE_TORRENT.name, 'Renamed') })))

    const exported = new Uint8Array(await exportTorrent(meta.infoHash))
    expect(exported).toEqual(duneTorrent())
    const original = await readTorrentFile(exported)
    expect(original.infoHash).toBe(meta.infoHash)
    expect(originalNames(await getTorrentFiles(meta.infoHash), original)).toHaveLength(4)
  })

  it('passes on qBittorrent’s refusals for a torrent without metadata: no export and no renames', async () => {
    const HASH = 'c'.repeat(40)
    await startKinopeer({ qbittorrent: { torrents: [torrent(HASH)] } })
    await expect(exportTorrent(HASH)).rejects.toMatchObject({ name: 'QbittorrentError', status: 409 })
    await expect(renameFiles(HASH, [{ from: 'Movie.mkv', to: 'Movie (2020)/Movie (2020).mkv' }])).rejects.toMatchObject({ status: 409 })
    await expect(exportTorrent('d'.repeat(40))).rejects.toMatchObject({ status: 404 })
  })
})

describe('matching torrents to titles', () => {
  it('keeps the user’s choice over a guess, one that found no title too, and forgets only the guesses', async () => {
    const A = 'a'.repeat(40)
    const B = 'b'.repeat(40)
    const guess = { type: 'movie', id: 27205, source: 'guess', version: 2 } as const
    const choice = { type: 'movie', id: 693134, source: 'user' } as const
    const { stores } = await startKinopeer()

    await expect(saveMatches({ [A]: guess })).resolves.toEqual({ [A]: guess })
    await expect(saveMatches({ [A]: choice })).resolves.toEqual({ [A]: choice })
    await expect(saveMatches({ [A]: { source: 'miss', version: 2 } })).resolves.toEqual({ [A]: choice })
    await expect(saveMatches({ [A]: { ...guess, version: 3 }, [B]: guess })).resolves.toEqual({ [A]: choice, [B]: guess })
    await expect(clearGuesses()).resolves.toEqual({ [A]: choice })
    expect(stores.matches.current).toEqual({ [A]: choice })
  })
})
