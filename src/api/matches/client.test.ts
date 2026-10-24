import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MatchesError, clearGuesses, getMatches, saveMatches } from './client'

const A = 'a'.repeat(40)
let fetchMock: Mock<typeof fetch>

function json(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getMatches', () => {
  it('reads the matches with the proxy’s cookies', async () => {
    json({ [A]: { type: 'movie', id: 1, source: 'user' } })
    await expect(getMatches()).resolves.toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/matches')
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('same-origin')
  })

  it('fails when the server has no matches route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getMatches()).rejects.toBeInstanceOf(MatchesError)
    json({ error: 'storage' }, 500)
    await expect(getMatches()).rejects.toMatchObject({ status: 500 })
  })
})

describe('saveMatches', () => {
  it('patches the matches as JSON and answers all of them', async () => {
    const guess = { [A]: { type: 'tv', id: 2, source: 'guess', version: 2 } } as const
    json(guess)
    await expect(saveMatches(guess)).resolves.toEqual(guess)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/matches')
    expect(init?.method).toBe('PATCH')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe(JSON.stringify(guess))
  })
})

describe('clearGuesses', () => {
  it('deletes the guesses', async () => {
    json({})
    await expect(clearGuesses()).resolves.toEqual({})
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })
})
