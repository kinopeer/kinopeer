import { describe, expect, it, vi } from 'vitest'
import type { Matches } from '../src/api/matches/types.ts'
import { finishedTitle, knownTitle } from './finishedTitle.ts'

describe('knownTitle', () => {
  it.each([
    ['the user’s choice over the tag', 'tmdb:movie:1', { type: 'tv', id: 2, source: 'user' }, { type: 'tv', id: 2 }],
    ['the tag over the server’s guess', 'other, tmdb:tv:3', { type: 'movie', id: 4, source: 'guess', version: 2 }, { type: 'tv', id: 3 }],
    ['the server’s guess without a tag', 'other', { type: 'movie', id: 4, source: 'guess' }, { type: 'movie', id: 4 }],
    ['nothing for a miss', '', { source: 'miss', version: 2 }, undefined],
    ['nothing for a tag of another kind', 'tmdb:person:5, tmdb:movie:x', undefined, undefined],
  ] as const)('%s', (_name, tags, match, title) => {
    expect(knownTitle(tags, match as Matches[string] | undefined)).toEqual(title)
  })
})

describe('finishedTitle', () => {
  const torrent = { hash: 'a', tags: 'kinopeer:notify,tmdb:movie:438631' }

  it('names a movie by its title and year in the language asked', async () => {
    const tmdb = vi.fn(async () => ({ title: 'Дюна', release_date: '2021-09-15' }))
    expect(await finishedTitle(torrent, 'ru', { matches: () => ({}), tmdb })).toBe('Дюна (2021)')
    expect(tmdb).toHaveBeenCalledWith('movie/438631?language=ru-RU')
  })

  it('names a series by its name and first year, from the user’s choice', async () => {
    const tmdb = vi.fn(async () => ({ name: 'Shōgun', first_air_date: '2024-02-27' }))
    const matches = () => ({ a: { type: 'tv', id: 126308, source: 'user' } }) as Matches
    expect(await finishedTitle({ hash: 'a', tags: '' }, 'en', { matches, tmdb })).toBe('Shōgun (2024)')
    expect(tmdb).toHaveBeenCalledWith('tv/126308?language=en-US')
  })

  it('leaves the year out when TMDB has no date', async () => {
    expect(await finishedTitle(torrent, 'en', { matches: () => ({}), tmdb: async () => ({ title: 'Dune', release_date: '' }) })).toBe('Dune')
  })

  it('answers undefined without asking TMDB when the title isn’t known', async () => {
    const tmdb = vi.fn()
    expect(await finishedTitle({ hash: 'a', tags: '' }, 'en', { matches: () => ({}), tmdb })).toBeUndefined()
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('answers undefined, asking once, when TMDB fails or answers without a title', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('timeout')))
    expect(await finishedTitle(torrent, 'en', { matches: () => ({}), tmdb: failing })).toBeUndefined()
    expect(failing).toHaveBeenCalledTimes(1)
    expect(await finishedTitle(torrent, 'en', { matches: () => ({}), tmdb: async () => ({ title: ' ' }) })).toBeUndefined()
    expect(await finishedTitle(torrent, 'en', { matches: () => ({}), tmdb: async () => null })).toBeUndefined()
  })
})
