import { describe, expect, it } from 'vitest'
import { FAILURES_PER_LOCK, FIRST_LOCK_MS, FORGET_AFTER_MS, LoginThrottle, MAX_ADDRESSES, MAX_LOCK_MS, clientKey } from './loginThrottle.ts'

function throttle() {
  const clock = { now: 0 }
  return { clock, throttle: new LoginThrottle(() => clock.now) }
}

function fail(throttle: LoginThrottle, key: string, times = FAILURES_PER_LOCK) {
  for (let i = 0; i < times; i++) throttle.attempt(key)
}

describe('LoginThrottle', () => {
  it('locks an address after five failures, for a quarter of an hour, and only that address', () => {
    const { clock, throttle: t } = throttle()
    fail(t, 'a', FAILURES_PER_LOCK - 1)
    expect(t.retryAfter('a')).toBe(0)
    t.attempt('a')
    expect(t.retryAfter('a')).toBe(FIRST_LOCK_MS)
    expect(t.retryAfter('b')).toBe(0)
    clock.now += FIRST_LOCK_MS - 1
    expect(t.retryAfter('a')).toBe(1)
    clock.now += 1
    expect(t.retryAfter('a')).toBe(0)
  })

  it('doubles each next lock, up to a day', () => {
    const { clock, throttle: t } = throttle()
    const locks: number[] = []
    for (let i = 0; i < 9; i++) {
      fail(t, 'a')
      locks.push(t.retryAfter('a'))
      clock.now += t.retryAfter('a')
    }
    expect(locks).toEqual([1, 2, 4, 8, 16, 32, 64, 96, 96].map((quarters) => Math.min(quarters * FIRST_LOCK_MS, MAX_LOCK_MS)))
  })

  it('starts afresh after a right password', () => {
    const { clock, throttle: t } = throttle()
    fail(t, 'a')
    clock.now += FIRST_LOCK_MS
    t.attempt('a')
    t.succeeded('a')
    fail(t, 'a', FAILURES_PER_LOCK - 1)
    expect(t.retryAfter('a')).toBe(0)
    t.attempt('a')
    expect(t.retryAfter('a')).toBe(FIRST_LOCK_MS)
  })

  it('forgets an address a day after its last failure, but not while it’s locked', () => {
    const { clock, throttle: t } = throttle()
    // Within the day the count stands: the fifth locks.
    fail(t, 'c', FAILURES_PER_LOCK - 1)
    clock.now += 23 * 60 * 60_000
    t.attempt('c')
    expect(t.retryAfter('c')).toBe(FIRST_LOCK_MS)

    fail(t, 'a', FAILURES_PER_LOCK - 1)
    clock.now += FORGET_AFTER_MS
    t.attempt('a')
    expect(t.retryAfter('a')).toBe(0)

    // A day-long lock outlasts the day: the lock after it is a day again, not a quarter of an hour.
    for (let i = 0; i < 7; i++) {
      fail(t, 'b')
      clock.now += t.retryAfter('b')
    }
    fail(t, 'b')
    expect(t.retryAfter('b')).toBe(MAX_LOCK_MS)
    clock.now += MAX_LOCK_MS
    fail(t, 'b')
    expect(t.retryAfter('b')).toBe(MAX_LOCK_MS)
  })

  it(`keeps ${MAX_ADDRESSES} addresses, forgetting the one whose last failure is oldest`, () => {
    const { throttle: t } = throttle()
    fail(t, 'first')
    fail(t, 'second')
    for (let i = 0; i < MAX_ADDRESSES - 2; i++) t.attempt(`address ${i}`)
    // A new failure of 'first' makes 'second' the oldest.
    t.attempt('first')
    t.attempt('one more')
    expect(t.retryAfter('first')).toBe(FIRST_LOCK_MS)
    expect(t.retryAfter('second')).toBe(0)
  })
})

describe('clientKey', () => {
  it('counts an IPv4 address on its own, mapped into IPv6 too', () => {
    expect(clientKey('192.168.1.20')).toBe('192.168.1.20')
    expect(clientKey('::ffff:192.168.1.20')).toBe('192.168.1.20')
    expect(clientKey('::ffff:10.20.30.40')).toBe('10.20.30.40')
    // IPv4 digits as the tail of another IPv6 address don't make it IPv4.
    expect(clientKey('2001:db8::ffff:1.2.3.4')).toBe('2001:db8:0:0::/64')
    expect(clientKey(undefined)).toBe('unknown')
  })

  it('counts an IPv6 address by its /64, however it’s written', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64')
    expect(clientKey('2001:0db8:0001:0002::7')).toBe('2001:db8:1:2::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('2001::1:2:3:4:5')).toBe('2001:0:0:1::/64')
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
  })
})
