import { describe, expect, it } from 'vitest'
import type { Matches } from '../api/matches/types'
import { HASH, MISSING_GRACE_MS, merged, pruned, validMatch, validStoredMatch, withoutGuesses } from './titleMatches'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const V2 = 'c'.repeat(64)

const USER = { type: 'movie', id: 1, source: 'user' } as const
const GUESS = { type: 'tv', id: 2, source: 'guess', version: 2 } as const
const MISS = { source: 'miss', version: 2 } as const

/** What qBittorrent has: exactly these hashes. */
const having = (...hashes: string[]) => (hash: string) => hashes.includes(hash)

describe('merged', () => {
  it('keeps the user’s choice over a guess, and lets a choice or a newer guess replace a guess', () => {
    const first = merged({}, {
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'movie', id: 2, source: 'guess', version: 1 },
    })
    const second = merged(first, {
      [A]: { type: 'movie', id: 9, source: 'guess', version: 2 },
      [B]: { type: 'tv', id: 3, source: 'guess', version: 2 },
    })
    expect(second).toEqual({
      [A]: { type: 'movie', id: 1, source: 'user' },
      [B]: { type: 'tv', id: 3, source: 'guess', version: 2 },
    })
    expect(merged(second, { [B]: { type: 'movie', id: 4, source: 'user' } })[B]).toEqual({ type: 'movie', id: 4, source: 'user' })
  })

  it('lets the user change their choice', () => {
    expect(merged({ [A]: { type: 'movie', id: 1, source: 'user' } }, { [A]: { type: 'tv', id: 5, source: 'user' } })[A]).toEqual({ type: 'tv', id: 5, source: 'user' })
  })

  it('keeps a guess that found no title under the user’s choice and under a guess or a miss of the same or a newer version of guessing, not an older one, with no expiry', () => {
    const [C, D, E, F] = ['d', 'e', 'f', '0'].map((digit) => digit.repeat(40))
    const current = merged({}, {
      [A]: USER,
      [B]: GUESS,
      [C]: { ...GUESS, version: 3 },
      [V2]: { ...GUESS, version: 1 },
      [D]: { ...MISS, version: 3 },
      [E]: { ...MISS, version: 1 },
      // Saved before guesses had a version.
      [F]: { type: 'tv', id: 2, source: 'guess' },
    })
    // A device that loaded the matches before another one found the title still sends its miss.
    const next = merged(current, { [A]: MISS, [B]: MISS, [C]: MISS, [V2]: MISS, [D]: MISS, [E]: MISS, [F]: MISS })
    const kept = { [A]: USER, [B]: GUESS, [C]: { ...GUESS, version: 3 }, [V2]: MISS, [D]: { ...MISS, version: 3 }, [E]: MISS, [F]: MISS }
    expect(next).toEqual(kept)
    // Kept for as long as its torrent is there, however long that is.
    expect(pruned(next, having(...Object.keys(kept)), 100, Date.now() + 10 * 365 * 24 * 3600_000)).toEqual(kept)
  })

  it('replaces a guess that found no title by a guess, and a guess by another of the same version', () => {
    expect(merged({ [A]: MISS, [B]: GUESS }, { [A]: GUESS, [B]: { ...GUESS, id: 3 } })).toEqual({ [A]: GUESS, [B]: { ...GUESS, id: 3 } })
  })

  it('replaces nothing by a guess of an older version of guessing, from a page open since before it changed', () => {
    const C = 'd'.repeat(40)
    const current = { [A]: MISS, [B]: GUESS, [C]: MISS }
    // A guess without a version is from before guesses had one.
    expect(merged(current, { [A]: { ...GUESS, version: 1 }, [B]: { ...GUESS, id: 3, version: 1 }, [C]: { type: 'tv', id: 3, source: 'guess' } })).toBe(current)
  })

  it('forgets matches set to null, the user’s choice too', () => {
    expect(merged({ [A]: USER, [B]: GUESS }, { [A]: null, [V2]: null })).toEqual({ [B]: GUESS })
  })

  it('drops the note that a torrent went missing when a new match is saved for it', () => {
    expect(merged({ [B]: { ...GUESS, missingSince: 1000 } }, { [B]: USER })).toEqual({ [B]: USER })
  })

  it('answers the matches it was given, as they are, when nothing sent changes them, and keeps those it doesn’t change as they are', () => {
    const current: Matches = { [A]: USER, [B]: GUESS }
    // A guess under the user's choice, and a torrent with no match forgotten.
    expect(merged(current, { [A]: GUESS, [V2]: null })).toBe(current)
    const next = merged(current, { [V2]: MISS })
    expect(next).not.toBe(current)
    expect(current).toEqual({ [A]: USER, [B]: GUESS })
    expect(next[A]).toBe(current[A])
  })
})

describe('pruned', () => {
  it('forgets a torrent’s match only after qBittorrent has not had it for the whole grace period', () => {
    const first = pruned({ [A]: USER, [B]: GUESS, [V2]: GUESS }, having(A, V2), 100, 1000)
    expect(first).toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 }, [V2]: GUESS })

    // Still within the grace period: the note keeps its first time.
    const second = pruned(first, having(A), 100, 1050)
    expect(second).toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 }, [V2]: { ...GUESS, missingSince: 1050 } })

    // V2 is back; B has been gone for the whole grace period.
    expect(pruned(second, having(A, V2), 100, 1100)).toEqual({ [A]: USER, [V2]: GUESS })
  })

  it('forgets a guess that found no title with its torrent, as other matches', () => {
    const first = pruned({ [A]: MISS, [B]: MISS }, having(A), 100, 1000)
    expect(first).toEqual({ [A]: MISS, [B]: { ...MISS, missingSince: 1000 } })
    expect(pruned(first, having(A), 100, 1100)).toEqual({ [A]: MISS })
  })

  it('keeps a missing torrent’s match for a week', () => {
    const DAY = 24 * 3600_000
    const noted: Matches = { [A]: { ...USER, missingSince: 0 } }
    expect(pruned(noted, having(), MISSING_GRACE_MS, 7 * DAY - 1)).toBe(noted)
    expect(pruned(noted, having(), MISSING_GRACE_MS, 7 * DAY)).toEqual({})
  })

  it('answers the matches it was given, as they are, when every torrent is still there', () => {
    const current: Matches = { [A]: USER }
    expect(pruned(current, having(A, B), 100, 1000)).toBe(current)
  })
})

describe('withoutGuesses', () => {
  it('forgets guesses, those that found no title too, and keeps choices', () => {
    expect(withoutGuesses({ [A]: { type: 'movie', id: 1, source: 'user' }, [B]: { type: 'movie', id: 2, source: 'guess', version: 2 }, [V2]: MISS })).toEqual({ [A]: { type: 'movie', id: 1, source: 'user' } })
  })

  it('answers the matches it was given, as they are, when they are all choices', () => {
    const current: Matches = { [A]: USER }
    expect(withoutGuesses(current)).toBe(current)
  })
})

describe('HASH', () => {
  it('takes an info hash, v1 or v2, and nothing around one', () => {
    expect([A, V2].map((hash) => HASH.test(hash))).toEqual([true, true])
    expect([`x${A}`, `${A}x`, 'a'.repeat(39), 'A'.repeat(40)].map((hash) => HASH.test(hash))).toEqual([false, false, false, false])
  })
})

describe('validMatch', () => {
  it.each([null, undefined, 0, ''])('refuses %j, which has no fields to read', (value) => {
    expect(validMatch(value)).toBe(false)
  })
})

describe('validStoredMatch', () => {
  it.each([USER, GUESS, MISS, { ...GUESS, missingSince: 1000 }, { ...MISS, missingSince: 1000 }])('takes a match a store keeps: %j', (match) => {
    expect(validStoredMatch(match)).toBe(true)
  })

  it.each([
    null,
    'user',
    { ...GUESS, missingSince: '1000' },
    { ...GUESS, missingSince: 1.5 },
    { ...GUESS, id: 0 },
    { ...MISS, type: 'tv' },
    { ...USER, title: 'Dune' },
  ])('refuses what no store keeps: %j', (value) => {
    expect(validStoredMatch(value)).toBe(false)
  })
})
