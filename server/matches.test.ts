import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Matches } from '../src/api/matches/types.ts'
import { MatchesStore, matchesMiddleware } from './matches.ts'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const V2 = 'c'.repeat(64)

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
      { [A]: good, [B]: null },
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
