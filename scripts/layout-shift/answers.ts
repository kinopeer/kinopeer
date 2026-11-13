// The rules by which the layout shift test lets a screen's answers land: which answer a request is,
// which answers the page asks for at each point, which held answer lands next, and whether a screen's
// chain gives two orders or one. Pure, with no Node or browser APIs: the browser side
// (e2e/performance/layoutShift.ts) holds the requests and hands their names here
// (docs/TESTING.md → The layout shift test).

/**
 * Where an answer sits in a screen's chain, from the screen's code: the page asks for it once every
 * answer of `after` has landed and, with `afterAny`, at least one of those. An answer with neither
 * is asked for as the page loads.
 */
export type Link = { after?: string[]; afterAny?: string[] }

/** A screen's chain: each of its answers by name, in the order a request is claimed by them (`claimant`). */
export type Chain = Record<string, Link>

/**
 * Which held answer lands next: the one the page asked for first, or the one it asked for last.
 * Answers that wait for each other land in the one order their chain allows under either.
 */
export type Order = 'first' | 'last'

/** Each order as a test's name says it. */
export const ORDER_NAMES: Record<Order, string> = {
  first: 'the first asked lands first',
  last: 'the last asked lands first',
}

/** An answer the page has asked for and the test holds: its name and when it was first asked, as a count of requests. */
export type Held = { name: string; asked: number }

/** Whether the page asks for an answer once `landed` have: all of its `after`, and one of its `afterAny`. */
export function isDue(link: Link, landed: ReadonlySet<string>): boolean {
  const { after = [], afterAny = [] } = link
  return after.every((name) => landed.has(name)) && (afterAny.length === 0 || afterAny.some((name) => landed.has(name)))
}

/**
 * The answers the page asks for once `landed` have and hasn't asked for yet: the test waits for each
 * to be asked before it lets the next answer land, so what is held when it chooses doesn't depend
 * on how fast the page asked.
 */
export function due(chain: Chain, asked: ReadonlySet<string>, landed: ReadonlySet<string>): string[] {
  return Object.keys(chain).filter((name) => !asked.has(name) && isDue(chain[name], landed))
}

/**
 * Which answer a request is, among those whose routes it matches (`candidates`, in the chain's
 * order): the first not asked for yet, so the same address asked for twice is two answers (the
 * session's check of the server's settings, then the screen's); else the last one's later request,
 * another address (another poster) or, for an answer that `polls`, the same address again (the
 * next poll). The same method and address asked for again (`repeat`) beyond the answers that claim
 * it is none of them: a request the case doesn't name.
 */
export function claimant(
  candidates: string[],
  asked: ReadonlySet<string>,
  again: { repeat: boolean; polls: ReadonlySet<string | undefined> },
): string | undefined {
  const fresh = candidates.find((name) => !asked.has(name))
  if (fresh !== undefined) return fresh
  const last = candidates.at(-1)
  return again.repeat && !again.polls.has(last) ? undefined : last
}

/** A screen's chain from its answers: where each sits, without what else the answer carries. */
export function chainOf(answers: Record<string, Link>): Chain {
  return Object.fromEntries(
    Object.entries(answers).map(([name, { after, afterAny }]) => [name, { ...(after && { after }), ...(afterAny && { afterAny }) }]),
  )
}

/**
 * Says what is wrong when the page asked for `name` before the answers its chain says it waits
 * for were let go: the chain is wrong, and the order the test chose would rest on a race.
 */
export function askedEarly(chain: Chain, name: string, released: ReadonlySet<string>): string | undefined {
  if (isDue(chain[name], released)) return undefined
  const { after = [], afterAny = [] } = chain[name]
  const waits = [after.length > 0 && `after ${after.join(', ')}`, afterAny.length > 0 && `after one of ${afterAny.join(', ')}`].filter(Boolean)
  const gone = [...released].join(', ') || 'none'
  return `The page asked for "${name}" before the answers its chain waits for had landed (${waits.join(' and ')}; let go so far: ${gone}): fix the chain from the screen's code`
}

/** The held answer that lands next: the one asked for first, or the one asked for last. */
export function pick(held: Held[], order: Order): string {
  if (held.length === 0) throw new Error('Nothing is held to let land')
  const sorted = [...held].sort((a, b) => a.asked - b.asked)
  return (order === 'first' ? sorted[0] : sorted.at(-1)!).name
}

/**
 * The orders a chain is run in: both, when at some point two answers or more are out at once;
 * one, when every answer waits for the one before it, so both orders are the same.
 */
export function orders(chain: Chain): Order[] {
  const landed = new Set<string>()
  for (;;) {
    const out = Object.keys(chain).filter((name) => !landed.has(name) && isDue(chain[name], landed))
    if (out.length > 1) return ['first', 'last']
    if (out.length === 0) return ['first']
    landed.add(out[0])
  }
}

/**
 * What is wrong with a chain itself: an answer waiting for one the chain doesn't name, or one the
 * page could never be asked for, as it waits for itself or for an answer that never lands.
 */
export function chainProblems(chain: Chain): string[] {
  const names = new Set(Object.keys(chain))
  const unknown = Object.entries(chain).flatMap(([name, { after = [], afterAny = [] }]) =>
    [...after, ...afterAny].filter((other) => !names.has(other)).map((other) => `"${name}" waits for "${other}", which the chain doesn't name`),
  )
  if (unknown.length > 0) return unknown
  const landed = new Set<string>()
  for (let out = due(chain, landed, landed); out.length > 0; out = due(chain, landed, landed)) for (const name of out) landed.add(name)
  return [...names].filter((name) => !landed.has(name)).map((name) => `"${name}" is never asked for: it waits for answers that can't all land first`)
}
