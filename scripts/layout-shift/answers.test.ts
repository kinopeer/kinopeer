import { describe, expect, it } from 'vitest'
import { askedEarly, chainOf, chainProblems, claimant, due, isDue, orders, pick, type Chain, type Link } from './answers.ts'

/** A screen's chain as the test's cases give them: a session, then two answers out at once, then one after both, and one after either. */
const CHAIN: Chain = {
  version: {},
  settings: { after: ['version'] },
  torrents: { after: ['settings'] },
  matches: { after: ['settings'] },
  guess: { after: ['torrents', 'matches'] },
  posters: { afterAny: ['torrents', 'guess'] },
}
const set = (...names: string[]) => new Set(names)

describe('isDue', () => {
  it('is due at once with nothing to wait for', () => {
    expect(isDue({}, set())).toBe(true)
  })

  it('waits for every answer of after', () => {
    expect(isDue(CHAIN.guess, set('torrents'))).toBe(false)
    expect(isDue(CHAIN.guess, set('matches'))).toBe(false)
    expect(isDue(CHAIN.guess, set('torrents', 'matches'))).toBe(true)
  })

  it('waits for any one answer of afterAny', () => {
    expect(isDue(CHAIN.posters, set())).toBe(false)
    expect(isDue(CHAIN.posters, set('guess'))).toBe(true)
    expect(isDue(CHAIN.posters, set('torrents'))).toBe(true)
  })

  it('waits for both when an answer has after and afterAny', () => {
    const link = { after: ['a'], afterAny: ['b', 'c'] }
    expect(isDue(link, set('a'))).toBe(false)
    expect(isDue(link, set('c'))).toBe(false)
    expect(isDue(link, set('a', 'c'))).toBe(true)
  })
})

describe('due', () => {
  it('gives what the page asks for once those have landed, in the chain order', () => {
    expect(due(CHAIN, set(), set())).toEqual(['version'])
    expect(due(CHAIN, set('version', 'settings'), set('version', 'settings'))).toEqual(['torrents', 'matches'])
  })

  it('leaves out what was asked for already', () => {
    expect(due(CHAIN, set('version', 'settings', 'torrents'), set('version', 'settings'))).toEqual(['matches'])
  })

  it('gives an answer as due once any of its afterAny has landed', () => {
    expect(due(CHAIN, set('version', 'settings', 'torrents', 'matches'), set('version', 'settings', 'torrents'))).toEqual(['posters'])
  })
})

describe('claimant', () => {
  const none = new Set<string>()

  it('gives a request to the only answer it matches', () => {
    expect(claimant(['torrents'], set(), none)).toBe('torrents')
  })

  it('gives the same address asked twice to each answer in turn, in the chain order', () => {
    expect(claimant(['tmdbSetup', 'defaults'], set(), none)).toBe('tmdbSetup')
    expect(claimant(['tmdbSetup', 'defaults'], set('tmdbSetup'), none)).toBe('defaults')
  })

  it('gives a later request to the last answer once every one was asked, when that answer takes later requests: the next poll, another poster', () => {
    expect(claimant(['torrents'], set('torrents'), set('torrents'))).toBe('torrents')
    expect(claimant(['titleP1', 'posters'], set('titleP1', 'posters'), set('posters'))).toBe('posters')
  })

  it('gives a request beyond the answers that claim it to none, when the last takes no later ones', () => {
    expect(claimant(['tmdbSetup', 'defaults'], set('tmdbSetup', 'defaults'), none)).toBeUndefined()
    expect(claimant(['tmdbSetup', 'defaults'], set('tmdbSetup', 'defaults'), set('tmdbSetup'))).toBeUndefined()
  })

  it('gives a request no answer matches to none', () => {
    expect(claimant([], set('torrents'), set('torrents'))).toBeUndefined()
  })
})

describe('chainOf', () => {
  it('keeps of each answer only where it sits in the chain', () => {
    const answers: Record<string, Link & { matches?: () => boolean }> = {
      version: { matches: () => true },
      settings: { after: ['version'], matches: () => true },
      posters: { afterAny: ['settings'], after: undefined },
    }
    expect(chainOf(answers)).toEqual({ version: {}, settings: { after: ['version'] }, posters: { afterAny: ['settings'] } })
  })
})

describe('askedEarly', () => {
  it('passes an answer asked once what it waits for was let go', () => {
    expect(askedEarly(CHAIN, 'guess', set('version', 'settings', 'torrents', 'matches'))).toBeUndefined()
    expect(askedEarly(CHAIN, 'version', set())).toBeUndefined()
  })

  it('names an answer asked before what it waits for was let go, with what was', () => {
    expect(askedEarly(CHAIN, 'guess', set('version', 'settings', 'torrents'))).toBe(
      'The page asked for "guess" before the answers its chain waits for had landed (after torrents, matches; let go so far: version, settings, torrents): fix the chain from the screen\'s code',
    )
  })

  it('names what an answer waits for one of, and says when nothing was let go', () => {
    expect(askedEarly({ posters: { after: ['a'], afterAny: ['b', 'c'] } }, 'posters', set())).toBe(
      'The page asked for "posters" before the answers its chain waits for had landed (after a and after one of b, c; let go so far: none): fix the chain from the screen\'s code',
    )
    expect(askedEarly({ settings: { afterAny: ['version'] } }, 'settings', set())).toBe(
      'The page asked for "settings" before the answers its chain waits for had landed (after one of version; let go so far: none): fix the chain from the screen\'s code',
    )
  })
})

describe('pick', () => {
  const held = [
    { name: 'matches', asked: 4 },
    { name: 'torrents', asked: 2 },
    { name: 'defaults', asked: 3 },
  ]

  it('lets the answer asked first land first', () => {
    expect(pick(held, 'first')).toBe('torrents')
  })

  it('lets the answer asked last land first', () => {
    expect(pick(held, 'last')).toBe('matches')
  })

  it('has nothing to pick when nothing is held', () => {
    expect(() => pick([], 'first')).toThrow('Nothing is held to let land')
  })
})

describe('orders', () => {
  it('runs a chain in both orders when two answers are out at once at some point', () => {
    expect(orders(CHAIN)).toEqual(['first', 'last'])
  })

  it('runs a chain in one order when each answer waits for the one before', () => {
    expect(orders({ version: {}, settings: { after: ['version'] }, search: { after: ['settings'] } })).toEqual(['first'])
  })

  it('runs a chain in both orders when two answers are out from the start', () => {
    expect(orders({ a: {}, b: {} })).toEqual(['first', 'last'])
  })

  it('runs an empty chain once', () => {
    expect(orders({})).toEqual(['first'])
  })
})

describe('chainProblems', () => {
  it('finds nothing wrong with a chain every answer of which is asked for in time', () => {
    expect(chainProblems(CHAIN)).toEqual([])
  })

  it('names an answer waiting for one the chain does not name', () => {
    expect(chainProblems({ version: {}, settings: { after: ['versoin'] }, posters: { afterAny: ['title'] } })).toEqual([
      '"settings" waits for "versoin", which the chain doesn\'t name',
      '"posters" waits for "title", which the chain doesn\'t name',
    ])
  })

  it('names answers that wait for each other, so the page never asks for them', () => {
    expect(chainProblems({ version: {}, a: { after: ['b'] }, b: { after: ['a'] }, c: { afterAny: ['a'] } })).toEqual([
      '"a" is never asked for: it waits for answers that can\'t all land first',
      '"b" is never asked for: it waits for answers that can\'t all land first',
      '"c" is never asked for: it waits for answers that can\'t all land first',
    ])
  })

  it('finds an answer that waits for one landing only after it', () => {
    expect(chainProblems({ a: { after: ['a'] } })).toEqual(['"a" is never asked for: it waits for answers that can\'t all land first'])
  })
})
