import { describe, expect, it, vi } from 'vitest'
import { onSignInNeed, setSignInNeed, signInNeed } from './signInNeed'

describe('signInNeed', () => {
  it('tells its listeners when it changes, and only then', () => {
    const listener = vi.fn()
    const stop = onSignInNeed(listener)
    expect(signInNeed()).toBeNull()

    setSignInNeed('set-up')
    setSignInNeed('set-up')
    expect(signInNeed()).toBe('set-up')
    expect(listener).toHaveBeenCalledOnce()

    setSignInNeed('sign-in')
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    setSignInNeed(null)
    expect(signInNeed()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
