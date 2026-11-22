import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Matches } from '../src/api/matches/types.ts'
import { MatchesStore, matchesMiddleware, qbittorrentHashes, startMatchesCleanup } from './matches.ts'
import { closeServers, serve } from './test/fakes.ts'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const V2 = 'c'.repeat(64)

const USER = { type: 'movie', id: 1, source: 'user' } as const
const GUESS = { type: 'tv', id: 2, source: 'guess', version: 2 } as const
const MISS = { source: 'miss', version: 2 } as const

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-matches-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

/** Kinopeer's side: the middleware under test over `store`. */
const kinopeer = (store = new MatchesStore(dir)) => serve(matchesMiddleware(store))

function patch(app: string, body: unknown, contentType = 'application/json') {
  return fetch(`${app}/api/matches`, {
    method: 'PATCH',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// The store's rules themselves are src/logic/titleMatches.ts's, tested there; these check that the
// store applies them and keeps what they answer in matches.json.
describe('MatchesStore', () => {
  const written = async () => JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8')) as Matches

  it('saves matches where the rules let them, forgets those set to null, and keeps them in matches.json', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS })
    expect(await store.save({ [A]: GUESS, [B]: null, [V2]: MISS })).toEqual({ [A]: USER, [V2]: MISS })
    expect(store.current).toEqual({ [A]: USER, [V2]: MISS })
    expect(await written()).toEqual({ [A]: USER, [V2]: MISS })
  })

  it('notes a torrent qBittorrent no longer has, forgets its match after the grace period, and keeps that in matches.json', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS })
    await store.prune(new Set([A]), 100, 1000)
    expect(await written()).toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 } })
    expect(await store.prune(new Set([A]), 100, 1100)).toEqual({ [A]: USER })
    expect(await written()).toEqual({ [A]: USER })
  })

  it('forgets guesses and keeps choices in matches.json', async () => {
    const store = new MatchesStore(dir)
    await store.save({ [A]: USER, [B]: GUESS })
    expect(await store.clearGuesses()).toEqual({ [A]: USER })
    expect(await written()).toEqual({ [A]: USER })
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
    const app = await kinopeer()
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

    // A guess that found no title is saved and answered like the others.
    const C = 'd'.repeat(40)
    const miss = await patch(app, { [C]: MISS })
    expect(miss.status).toBe(200)
    expect(((await miss.json()) as Matches)[C]).toEqual(MISS)
    expect(JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8'))).toMatchObject(saved)
  })

  it('answers the user’s choice when a guess comes for the same torrent', async () => {
    const app = await kinopeer()
    await patch(app, { [A]: { type: 'movie', id: 1, source: 'user' } })
    const response = await patch(app, { [A]: { type: 'movie', id: 2, source: 'guess', version: 2 } })
    expect(await response.json()).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('forgets matches set to null', async () => {
    const app = await kinopeer()
    await patch(app, { [A]: USER, [B]: GUESS })
    const response = await patch(app, { [A]: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ [B]: GUESS })
  })

  it('forgets guesses on DELETE', async () => {
    const app = await kinopeer()
    await patch(app, {
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'movie', id: 2, source: 'guess', version: 2 },
    })
    const response = await fetch(`${app}/api/matches`, { method: 'DELETE' })
    expect(await response.json()).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('rejects malformed matches and saves none of them', async () => {
    const app = await kinopeer()
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
      { [A]: { ...MISS, type: 'movie' } },
      { [A]: { ...MISS, id: 1 } },
      { [A]: { source: 'miss' } },
      { [A]: { ...MISS, version: 0 } },
      { [A]: { ...MISS, title: null } },
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
    const app = await kinopeer(new MatchesStore(join(dir, 'file', 'data')))
    const response = await patch(app, { [A]: { type: 'movie', id: 1, source: 'user' } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
  })

  it('leaves other paths alone', async () => {
    const app = await kinopeer()
    expect(await (await fetch(`${app}/api/matches/x`)).text()).toBe('fallback')
    expect(await (await fetch(`${app}/api/settings`)).text()).toBe('fallback')
  })
})
