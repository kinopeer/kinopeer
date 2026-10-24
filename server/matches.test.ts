import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Matches } from '../src/api/matches/types.ts'
import { MatchesStore, matchesMiddleware, qbittorrentHashes, startMatchesCleanup } from './matches.ts'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const V2 = 'c'.repeat(64)

const USER = { type: 'movie', id: 1, source: 'user' } as const
const GUESS = { type: 'tv', id: 2, source: 'guess', version: 2 } as const

let dir: string
let server: Server | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinoseed-matches-'))
})

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve))
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

async function kinoseed(store = new MatchesStore(dir)): Promise<string> {
  const middleware = matchesMiddleware(store)
  server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function patch(app: string, body: unknown, contentType = 'application/json') {
  return fetch(`${app}/api/matches`, {
    method: 'PATCH',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('MatchesStore', () => {
  it('keeps the user’s choice over a guess, and lets a choice or a newer guess replace a guess', async () => {
    const store = new MatchesStore(dir)
    await store.save({
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'movie', id: 2, source: 'guess', version: 1 },
    })
    await store.save({
      [A]: { type: 'movie', id: 9, source: 'guess', version: 2 },
      [B]: { type: 'tv', id: 3, source: 'guess', version: 2 },
    })
    expect(store.current).toEqual({
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'tv', id: 3, source: 'guess', version: 2 },
    })
    await store.save({ [B]: { type: 'movie', id: 4, source: 'user' } })
    expect(store.current[B]).toEqual({ type: 'movie', id: 4, source: 'user' })
  })

  it('forgets guesses and keeps choices', async () => {
    const store = new MatchesStore(dir)
    await store.save({
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'movie', id: 2, source: 'guess', version: 2 },
    })
    expect(await store.clearGuesses()).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('forgets matches set to null, the user’s choice too', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS })
    expect(await store.save({ [A]: null, [V2]: null })).toEqual({ [B]: GUESS })
  })

  it('forgets a torrent’s match only after qBittorrent has not had it for the whole grace period', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS, [V2]: GUESS })

    await store.prune(new Set([A, V2]), 100, 1000)
    expect(store.current).toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 }, [V2]: GUESS })

    // Still within the grace period: the note keeps its first time.
    await store.prune(new Set([A]), 100, 1050)
    expect(store.current).toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 }, [V2]: { ...GUESS, missingSince: 1050 } })

    // V2 is back; B has been gone for the whole grace period.
    await store.prune(new Set([A, V2]), 100, 1100)
    expect(store.current).toEqual({ [A]: USER, [V2]: GUESS })
    expect(JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8'))).toEqual({ [A]: USER, [V2]: GUESS })
  })

  it('keeps the note when a torrent comes back as a new match is saved for it', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [B]: GUESS })
    await store.prune(new Set(), 100, 1000)
    await store.save({ [B]: USER })
    expect(store.current).toEqual({ [B]: USER })
  })

  it('writes nothing when every torrent is still there', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER })
    await rm(join(dir, 'matches.json'))
    expect(await store.prune(new Set([A, B]), 100, 1000)).toBe(store.current)
    await expect(readFile(join(dir, 'matches.json'))).rejects.toThrow()
  })
})

describe('qbittorrentHashes', () => {
  it('answers every info hash qBittorrent has', async () => {
    const get = vi.fn(async () => Response.json([{ hash: A, name: 'Dune' }, { hash: V2 }, { name: 'no hash' }, null]))
    expect(await qbittorrentHashes(get)).toEqual(new Set([A, V2]))
    expect(get).toHaveBeenCalledWith('/api/v2/torrents/info')
  })

  it('answers nothing when qBittorrent doesn’t answer with its list', async () => {
    expect(await qbittorrentHashes(async () => new Response('Forbidden', { status: 403 }))).toBeUndefined()
    expect(await qbittorrentHashes(async () => Response.json({ error: 'x' }))).toBeUndefined()
  })
})

describe('startMatchesCleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks a minute after start and then every hour, and stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] })
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS })
    const hashes = vi.fn(async () => new Set([A]))
    const prune = vi.spyOn(store, 'prune')
    const stop = startMatchesCleanup(store, hashes, { graceMs: 1000 })

    await vi.advanceTimersByTimeAsync(59_000)
    expect(hashes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(prune).toHaveBeenCalledWith(new Set([A]), 1000, Date.now())
    // The file is written with real I/O.
    await prune.mock.results[0]?.value
    expect(store.current[B]?.missingSince).toBe(Date.now())

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(hashes).toHaveBeenCalledTimes(2)
    await prune.mock.results[1]?.value
    expect(store.current).toEqual({ [A]: USER })

    stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(hashes).toHaveBeenCalledTimes(2)
  })

  it('changes nothing and keeps checking when qBittorrent doesn’t answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER })
    const hashes = vi
      .fn<() => Promise<Set<string> | undefined>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(new Set([A]))
    const stop = startMatchesCleanup(store, hashes, { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hashes.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(store.current).toEqual({ [A]: USER })
    stop()
  })
})

describe('matchesMiddleware', () => {
  it('answers no matches at first, saves new ones to matches.json and answers them all', async () => {
    const app = await kinoseed()
    const first = await fetch(`${app}/api/matches`)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.json()).toEqual({})

    const saved: Matches = {
      [A]: { type: 'movie', id: 438631, source: 'guess', version: 2 },
      [V2]: { type: 'tv', id: 1399, source: 'user' },
    }
    const response = await patch(app, saved)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(saved)

    expect((await patch(app, { [B]: { type: 'movie', id: 1, source: 'guess', version: 2 } })).status).toBe(200)
    expect(Object.keys((await (await fetch(`${app}/api/matches`)).json()) as Matches)).toEqual([A, V2, B])
    expect(JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8'))).toMatchObject(saved)
  })

  it('answers the user’s choice when a guess comes for the same torrent', async () => {
    const app = await kinoseed()
    await patch(app, { [A]: { type: 'movie', id: 1, source: 'user' } })
    const response = await patch(app, { [A]: { type: 'movie', id: 2, source: 'guess', version: 2 } })
    expect(await response.json()).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('forgets matches set to null', async () => {
    const app = await kinoseed()
    await patch(app, { [A]: USER, [B]: GUESS })
    const response = await patch(app, { [A]: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ [B]: GUESS })
  })

  it('forgets guesses on DELETE', async () => {
    const app = await kinoseed()
    await patch(app, {
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'movie', id: 2, source: 'guess', version: 2 },
    })
    const response = await fetch(`${app}/api/matches`, { method: 'DELETE' })
    expect(await response.json()).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('rejects malformed matches and saves none of them', async () => {
    const app = await kinoseed()
    const good = { type: 'movie', id: 1, source: 'guess', version: 2 }
    for (const body of [
      [good],
      { notahash: good },
      { [A.toUpperCase()]: good },
      { [A]: { ...good, type: 'person' } },
      { [A]: { ...good, id: 0 } },
      { [A]: { ...good, id: 1.5 } },
      { [A]: { ...good, source: 'tag' } },
      { [A]: { ...good, version: '2' } },
      { [A]: { ...good, title: 'Dune' } },
      { [A]: good, [B]: false },
    ]) {
      const response = await patch(app, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toEqual({ error: 'bad-request' })
    }
    expect((await patch(app, '{ not json')).status).toBe(400)
    expect((await patch(app, `{"${A}": ${JSON.stringify(good)}, "x": "${'x'.repeat(200_000)}"}`)).status).toBe(400)
    expect((await patch(app, { [A]: good }, 'text/plain')).status).toBe(415)
    expect((await fetch(`${app}/api/matches`, { method: 'PUT', body: '{}' })).status).toBe(405)
    expect(await (await fetch(`${app}/api/matches`)).json()).toEqual({})
  })

  it('says when matches.json can’t be written', async () => {
    // A file where the data directory should be.
    await writeFile(join(dir, 'file'), '')
    const app = await kinoseed(new MatchesStore(join(dir, 'file', 'data')))
    const response = await patch(app, { [A]: { type: 'movie', id: 1, source: 'user' } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
  })

  it('leaves other paths alone', async () => {
    const app = await kinoseed()
    expect(await (await fetch(`${app}/api/matches/x`)).text()).toBe('fallback')
    expect(await (await fetch(`${app}/api/settings`)).text()).toBe('fallback')
  })
})
