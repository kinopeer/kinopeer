/**
 * Holds back guessing Kinopeer's password: an address that gets it wrong `FAILURES_PER_LOCK` times
 * is refused for `FIRST_LOCK_MS`, and each lock after that, until a right password or a day without
 * failures once the last lock is over, lasts twice as long, up to `MAX_LOCK_MS`. So guessing runs at a few dozen tries a day,
 * while someone who mistypes waits a quarter of an hour at most. Kept in memory: a restart forgets it.
 *
 * An attempt counts as failed before the password is checked (`attempt`) and is taken back when it
 * was right (`succeeded`), so many requests at once from one address are counted before any is
 * answered.
 */
export const FAILURES_PER_LOCK = 5
export const FIRST_LOCK_MS = 15 * 60_000
export const MAX_LOCK_MS = 24 * 60 * 60_000
/** How long an address without failures, once its lock is over, keeps its count and its next lock's length. */
export const FORGET_AFTER_MS = 24 * 60 * 60_000
/** Addresses kept at most: past it, the one whose last failure is oldest is forgotten. */
export const MAX_ADDRESSES = 10_000

interface Entry {
  /** Failures since the last lock (or since the start). */
  failures: number
  /** Locks so far: the next one lasts FIRST_LOCK_MS × 2^locks. */
  locks: number
  lockedUntil: number
  lastFailure: number
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** How long `key` must wait before trying again, in ms: 0 when it may try now. */
  retryAfter(key: string): number {
    const entry = this.current(key)
    return entry ? Math.max(0, entry.lockedUntil - this.now()) : 0
  }

  /** Counts a try as failed, before the password is checked: `succeeded` takes it back. */
  attempt(key: string): void {
    const now = this.now()
    const entry = this.current(key) ?? { failures: 0, locks: 0, lockedUntil: 0, lastFailure: now }
    entry.failures += 1
    entry.lastFailure = now
    if (entry.failures >= FAILURES_PER_LOCK) {
      entry.lockedUntil = now + Math.min(FIRST_LOCK_MS * 2 ** entry.locks, MAX_LOCK_MS)
      entry.locks += 1
      entry.failures = 0
    }
    // Delete first, so the map's order is the order of the last failures.
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > MAX_ADDRESSES) this.entries.delete(this.entries.keys().next().value!)
  }

  /** The password was right: the address starts afresh. */
  succeeded(key: string): void {
    this.entries.delete(key)
  }

  /** The entry for `key`, or undefined once it has had no failure for FORGET_AFTER_MS after its lock. */
  private current(key: string): Entry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    const now = this.now()
    if (now - Math.max(entry.lastFailure, entry.lockedUntil) >= FORGET_AFTER_MS) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }
}

/**
 * Whose tries count together: an IPv4 address on its own, and an IPv6 address by its /64, the
 * network a single device or household gets, where a guesser could take a new address for each try.
 * Behind a reverse proxy every request comes from the proxy, so all of them count together.
 */
export function clientKey(address: string | undefined): string {
  if (!address) return 'unknown'
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return mapped[1]
  if (!address.includes(':')) return address
  return `${expandIpv6(address).slice(0, 4).join(':')}::/64`
}

/** The eight groups of an IPv6 address, without its zone; an IPv4 tail counts as the last two. */
function expandIpv6(address: string): string[] {
  const plain = address.split('%')[0].toLowerCase()
  const [head, tail = ''] = plain.split('::')
  const groups = (part: string) => (part ? part.split(':') : [])
  const left = groups(head)
  const right = plain.includes('::') ? groups(tail) : []
  const missing = 8 - left.length - right.length
  return [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right].map((group) => group.replace(/^0+(?=.)/, ''))
}
