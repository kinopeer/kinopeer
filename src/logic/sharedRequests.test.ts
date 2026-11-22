import { describe, expect, it, vi } from 'vitest'
import { createSharedRequests, isFresh } from './sharedRequests'

/** A load whose answer the test gives, with the signal it was handed. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const signals: AbortSignal[] = []
  const load = vi.fn((signal: AbortSignal) => {
    signals.push(signal)
    return new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
  })
  return { load, signals, resolve: (value: T) => resolve(value), reject: (reason: unknown) => reject(reason) }
}

/** Shared requests on a clock the test moves. */
function setup() {
  let time = 1_000
  const shared = createSharedRequests(() => time)
  return { shared, later: (ms: number) => (time += ms) }
}

describe('isFresh', () => {
  it('takes an answer younger than asked for, and not one as old', () => {
    expect(isFresh(1_000, 1_000, 60)).toBe(true)
    expect(isFresh(1_000, 1_059, 60)).toBe(true)
    expect(isFresh(1_000, 1_060, 60)).toBe(false)
    expect(isFresh(1_000, 1_000, 0)).toBe(false)
  })

  it('doesn’t take an answer from after now, the clock having been set back', () => {
    expect(isFresh(1_000, 999, 60)).toBe(false)
  })
})

describe('createSharedRequests', () => {
  it('serves callers that ask while a request is on its way with that one request', async () => {
    const { shared } = setup()
    const { load, resolve } = deferred<string>()
    const first = shared.get('k', load, { freshFor: 0 })
    const second = shared.get('k', load, { freshFor: 0 })
    resolve('answer')
    await expect(first).resolves.toBe('answer')
    await expect(second).resolves.toBe('answer')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('serves a later caller the kept answer while it’s as fresh as asked, then asks again', async () => {
    const { shared, later } = setup()
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await shared.get('k', load, { freshFor: 60 })
    later(59)
    await expect(shared.get('k', load, { freshFor: 60 })).resolves.toBe('first')
    // Another caller asks for fresher.
    await expect(shared.get('k', load, { freshFor: 0 })).resolves.toBe('second')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps answers by key', async () => {
    const { shared } = setup()
    const load = vi.fn((signal: AbortSignal) => Promise.resolve(signal))
    await shared.get('a', load, { freshFor: 60 })
    await shared.get('b', load, { freshFor: 60 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives a failure to the callers that waited for it and keeps nothing, so the next one asks again', async () => {
    const { shared } = setup()
    const { load, reject } = deferred<string>()
    const first = shared.get('k', load, { freshFor: 60 })
    const second = shared.get('k', load, { freshFor: 60 })
    reject(new Error('down'))
    await expect(first).rejects.toThrow('down')
    await expect(second).rejects.toThrow('down')

    const again = vi.fn().mockResolvedValue('up')
    await expect(shared.get('k', again, { freshFor: 60 })).resolves.toBe('up')
    expect(shared.peek('k', 60)).toEqual({ data: 'up' })
  })

  it('renews: a new request whatever is on its way or kept, whose answer replaces the kept one', async () => {
    const { shared } = setup()
    const old = deferred<string>()
    const waiting = shared.get('k', old.load, { freshFor: 60 })
    const renewed = deferred<string>()
    const fresh = shared.get('k', renewed.load, { freshFor: 60, renew: true })
    expect(renewed.load).toHaveBeenCalledTimes(1)

    renewed.resolve('new')
    old.resolve('old')
    await expect(fresh).resolves.toBe('new')
    // The caller before the renewal keeps the answer it waited for, which doesn't replace the newer one.
    await expect(waiting).resolves.toBe('old')
    expect(shared.peek('k', 60)).toEqual({ data: 'new' })

    const again = vi.fn().mockResolvedValue('newer')
    await expect(shared.get('k', again, { freshFor: 60, renew: true })).resolves.toBe('newer')
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('keeps a renewed request when the one it replaced is given up, and a failed renewal leaves the key to the next', async () => {
    const { shared } = setup()
    const old = deferred<string>()
    const controller = new AbortController()
    const leaving = shared.get('k', old.load, { freshFor: 60, signal: controller.signal })
    const failing = deferred<string>()
    const failed = shared.get('k', failing.load, { freshFor: 60, renew: true })
    failing.reject(new Error('down'))
    await expect(failed).rejects.toThrow('down')
    const renewed = deferred<string>()
    const fresh = shared.get('k', renewed.load, { freshFor: 60, renew: true })

    controller.abort()
    await expect(leaving).rejects.toBe(controller.signal.reason)
    // Joins the renewed request rather than starting another.
    const joined = shared.get('k', vi.fn(), { freshFor: 60 })
    renewed.resolve('new')
    await expect(fresh).resolves.toBe('new')
    await expect(joined).resolves.toBe('new')
  })

  it('keeps a renewed request when the one it replaced fails after it', async () => {
    const { shared } = setup()
    const old = deferred<string>()
    const waiting = shared.get('k', old.load, { freshFor: 60 })
    const renewed = deferred<string>()
    const fresh = shared.get('k', renewed.load, { freshFor: 60, renew: true })
    old.reject(new Error('down'))
    await expect(waiting).rejects.toThrow('down')
    // Joins the renewed request rather than starting another.
    const joined = shared.get('k', vi.fn(), { freshFor: 60 })
    renewed.resolve('new')
    await expect(fresh).resolves.toBe('new')
    await expect(joined).resolves.toBe('new')
  })

  it('goes on with a request while anyone waits for it, and cancels it when the last one gives up', async () => {
    const { shared } = setup()
    const { load, signals, resolve } = deferred<string>()
    const one = new AbortController()
    const two = new AbortController()
    const first = shared.get('k', load, { freshFor: 60, signal: one.signal })
    const second = shared.get('k', load, { freshFor: 60, signal: two.signal })

    one.abort()
    await expect(first).rejects.toBe(one.signal.reason)
    expect(signals[0].aborted).toBe(false)
    two.abort()
    await expect(second).rejects.toBe(two.signal.reason)
    expect(signals[0].aborted).toBe(true)

    // Forgotten: the next caller asks again, and an answer to the cancelled one isn't kept.
    resolve('late')
    const again = vi.fn().mockResolvedValue('again')
    await expect(shared.get('k', again, { freshFor: 60 })).resolves.toBe('again')
  })

  it('never cancels a request someone waits for who can’t give up', async () => {
    const { shared } = setup()
    const { load, signals, resolve } = deferred<string>()
    const held = shared.get('k', load, { freshFor: 60 })
    const controller = new AbortController()
    const leaving = shared.get('k', load, { freshFor: 60, signal: controller.signal })
    controller.abort()
    await expect(leaving).rejects.toBe(controller.signal.reason)
    expect(signals[0].aborted).toBe(false)
    resolve('answer')
    await expect(held).resolves.toBe('answer')
  })

  it('doesn’t cancel a request that answered as its last caller gave up', async () => {
    const { shared } = setup()
    const { load, signals, resolve } = deferred<string>()
    const controller = new AbortController()
    const first = shared.get('k', load, { freshFor: 60, signal: controller.signal })
    resolve('answer')
    // The answer is in before the caller's own wait settles.
    await Promise.resolve()
    controller.abort()
    await first.catch(() => {})
    expect(signals[0].aborted).toBe(false)
    expect(shared.peek('k', 60)).toEqual({ data: 'answer' })
  })

  it('doesn’t ask for a caller that has given up already', async () => {
    const { shared } = setup()
    const load = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(shared.get('k', load, { freshFor: 60, signal: controller.signal })).rejects.toBe(controller.signal.reason)
    expect(load).not.toHaveBeenCalled()
  })

  it('shows a kept answer as fresh as asked, and none on its way or older', async () => {
    const { shared, later } = setup()
    const { load, resolve } = deferred<string>()
    const asked = shared.get('k', load, { freshFor: 60 })
    expect(shared.peek('k', 60)).toBeUndefined()
    resolve('answer')
    await asked
    expect(shared.peek('k', 60)).toEqual({ data: 'answer' })
    later(60)
    expect(shared.peek('k', 60)).toBeUndefined()
    expect(shared.peek('other', 60)).toBeUndefined()
  })

  it('keeps an answer the app got otherwise, over a request on its way before it', async () => {
    const { shared } = setup()
    const { load, resolve } = deferred<string>()
    const asked = shared.get('k', load, { freshFor: 60 })
    shared.set('k', 'saved')
    resolve('older')
    await expect(asked).resolves.toBe('older')
    expect(shared.peek('k', 60)).toEqual({ data: 'saved' })
    const none = vi.fn()
    await expect(shared.get('k', none, { freshFor: 60 })).resolves.toBe('saved')
    expect(none).not.toHaveBeenCalled()
  })

  it('tells the key’s followers each answer kept for it, until they leave', () => {
    const { shared } = setup()
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    const leaveFirst = shared.follow('k', first)
    shared.follow('k', second)
    shared.follow('other', other)
    shared.set('k', 'saved')
    expect(first).toHaveBeenCalledWith('saved')
    expect(second).toHaveBeenCalledWith('saved')
    expect(other).not.toHaveBeenCalled()

    leaveFirst()
    shared.set('k', 'again')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenLastCalledWith('again')
  })

  it('keeps a follower that came after another left, however often that one leaves', () => {
    const { shared } = setup()
    const first = vi.fn()
    const later = vi.fn()
    const leaveFirst = shared.follow('k', first)
    leaveFirst()
    shared.follow('k', later)
    leaveFirst()
    shared.set('k', 'saved')
    expect(later).toHaveBeenCalledWith('saved')
    expect(first).not.toHaveBeenCalled()
  })

  it('doesn’t tell followers of an answer a request of their own brought', async () => {
    const { shared } = setup()
    const follower = vi.fn()
    shared.follow('k', follower)
    await shared.get('k', () => Promise.resolve('answer'), { freshFor: 60 })
    expect(follower).not.toHaveBeenCalled()
  })

  it('forgets everything on clear and cancels what’s on its way', async () => {
    const { shared } = setup()
    await shared.get('kept', () => Promise.resolve('answer'), { freshFor: 60 })
    const { load, signals } = deferred<string>()
    void shared.get('asked', load, { freshFor: 60 }).catch(() => {})
    shared.clear()
    expect(signals[0].aborted).toBe(true)
    expect(shared.peek('kept', 60)).toBeUndefined()
  })
})
