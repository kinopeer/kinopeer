import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MatchesError, getMatches } from './client'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('getMatches', () => {
  it('fails when the server has no matches route', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getMatches()).rejects.toBeInstanceOf(MatchesError)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
  })
})
