import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatchesError, clearGuesses, getMatches, saveMatches } from '../../src/api/matches/client.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const USER = { type: 'movie', id: 693134, source: 'user' } as const
const GUESS = { type: 'tv', id: 126308, source: 'guess', version: 2 } as const

afterEach(async () => {
  vi.restoreAllMocks()
  await stopKinoseed()
})

describe('matches client through /api/matches', () => {
  it('reads the matches with the cookies a proxy in front of the server set', async () => {
    const { cookies, received } = await startKinoseed()
    cookies.set('UMBREL_PROXY_TOKEN', 'proxy-token')
    await expect(getMatches()).resolves.toEqual({})
    expect(received).toEqual([{ method: 'GET', url: '/api/matches', cookie: 'UMBREL_PROXY_TOKEN=proxy-token' }])
  })

  it('saves matches as JSON to matches.json and answers all of them', async () => {
    const { dataDir, received } = await startKinoseed()
    await expect(saveMatches({ [A]: USER })).resolves.toEqual({ [A]: USER })
    await expect(saveMatches({ [B]: GUESS })).resolves.toEqual({ [A]: USER, [B]: GUESS })
    expect(received.map((request) => request.method)).toEqual(['PATCH', 'PATCH'])
    expect(JSON.parse(await readFile(join(dataDir, 'matches.json'), 'utf8'))).toEqual({ [A]: USER, [B]: GUESS })
    await expect(getMatches()).resolves.toEqual({ [A]: USER, [B]: GUESS })
  })

  it('forgets the guesses on DELETE and answers what is left', async () => {
    const { received } = await startKinoseed()
    await saveMatches({ [A]: USER, [B]: GUESS })
    await expect(clearGuesses()).resolves.toEqual({ [A]: USER })
    expect(received.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/matches' })
  })

  it('says when matches.json can’t be written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startKinoseed({ writableData: false })
    const error = await saveMatches({ [A]: USER }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MatchesError)
    expect(error).toMatchObject({ status: 500 })
  })
})
